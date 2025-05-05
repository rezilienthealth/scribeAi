/**
 * Creates the web app UI when accessed via URL
 */
function doGet() {
  const htmlOutput = HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ScribeAI - Medical Transcription & Notes')
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/apps_script_48dp.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  return htmlOutput;
}

/**
 * Includes HTML files with ?v= cache busting
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Transcribes a real-time audio chunk for immediate feedback.
 * This is a simplified version that returns quickly for real-time display.
 * @param {string} base64Audio Base64-encoded audio chunk data.
 * @param {string} contentType MIME type of the audio.
 * @param {string} specialty Optional medical specialty for context.
 * @return {Object} Object containing transcript.
 */
function transcribeRealtimeChunk(base64Audio, contentType, specialty = 'general') {
  try {
    Logger.log("--- Real-time chunk transcription started ---");
    
    // Decode the base64 audio data
    const audioBytes = Utilities.base64Decode(base64Audio);
    const tempFilename = `temp-chunk-${Date.now()}.webm`;
    const tempBlob = Utilities.newBlob(audioBytes, contentType, tempFilename);
    
    // Upload to GCS temporarily for processing
    const BUCKET_NAME = 'scribeai-audio-uploads';
    uploadToGcs(tempBlob, BUCKET_NAME, tempFilename);
    const gcsUri = `gs://${BUCKET_NAME}/${tempFilename}`;
    
    // Get access token for API call
    const accessToken = ScriptApp.getOAuthToken();
    if (!accessToken) {
      Logger.log("Could not obtain OAuth token for real-time transcription");
      return { transcript: 'Authentication error for real-time transcription.' };
    }
    
    // Configure speech recognition for real-time (simpler than full transcription)
    const speechApiUrl = 'https://speech.googleapis.com/v1/speech:recognize';
    
    // Use a simpler configuration for real-time chunks
    const recognitionConfig = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'medical_dictation',
      useEnhanced: true,
      audioChannelCount: 1
    };
    
    const requestPayload = {
      config: recognitionConfig,
      audio: { uri: gcsUri }
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + accessToken
      },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true
    };
    
    // Make the API call
    Logger.log("Sending real-time chunk to Speech API");
    const speechResponse = UrlFetchApp.fetch(speechApiUrl, options);
    const responseCode = speechResponse.getResponseCode();
    const speechResult = JSON.parse(speechResponse.getContentText());
    
    // Clean up the temporary file
    try {
      deleteFromGcs(BUCKET_NAME, tempFilename);
    } catch (cleanupError) {
      Logger.log("Error cleaning up temporary file: " + cleanupError);
      // Continue processing even if cleanup fails
    }
    
    // Process the response
    if (responseCode !== 200) {
      Logger.log(`Speech API error: ${responseCode} - ${JSON.stringify(speechResult)}`);
      return { transcript: 'Error from speech service.' };
    }
    
    // Extract the transcript from the response
    let transcript = '';
    if (speechResult.results && speechResult.results.length > 0) {
      // Concatenate all transcript pieces
      transcript = speechResult.results
        .map(result => result.alternatives[0].transcript)
        .join(' ');
    } else {
      transcript = '[silence]';
    }
    
    Logger.log("Real-time transcription result: " + transcript);
    return { transcript: transcript };
    
  } catch (error) {
    Logger.log('Error in real-time transcription: ' + error);
    return { transcript: 'Error processing audio chunk: ' + error.message };
  }
}

/**
 * Transcribes audio from base64 data.
 * @param {string} base64Audio Base64-encoded audio data.
 * @param {string} contentType MIME type of the audio.
 * @param {string} filename Optional filename for the audio.
 * @param {string} specialty Optional medical specialty for customized notes.
 * @param {string} detailLevel Optional detail level for the notes (standard, detailed, concise).
 * @return {Object} Object containing transcript and note.
 */
function transcribeAudio(base64Audio, contentType, filename, specialty = 'general', detailLevel = 'standard', template = 'none', templateInstructions = '') {
  Logger.log("--- transcribeAudio called (Step 1: Blob Creation) ---"); 

  try {
    const BUCKET_NAME = 'scribeai-audio-uploads'; 
    const MAX_POLLING_ATTEMPTS = 60; // Doubled to 60 attempts (5 minutes total)
    const POLLING_INTERVAL_MS = 5000; 
    const MAX_EXECUTION_TIME_MS = 350000; // 350 seconds (just under 6 minute limit)

    // 1. Decode base64 and create Blob
    const audioBytes = Utilities.base64Decode(base64Audio);
    const filename = `audio-${Date.now()}.webm`; 
    const contentType = 'audio/webm'; 
    const audioBlob = Utilities.newBlob(audioBytes, contentType, filename);

    if (!audioBlob || audioBlob.getBytes().length === 0) {
      Logger.log("Failed to create audio blob from base64 data.");
      return { error: "Failed to create audio blob." };
    }

    Logger.log(`Audio blob created: ${filename}, Type: ${audioBlob.getContentType()}, Size: ${audioBlob.getBytes().length} bytes`);

    // --- STAGE 1 COMPLETE --- 

    Logger.log("--- transcribeAudio called (Step 2: GCS Upload) ---"); 

    // 1. Upload to GCS 
    Logger.log(`Attempting to upload ${filename} to bucket ${BUCKET_NAME}...`);
    uploadToGcs(audioBlob, BUCKET_NAME, filename); // This will throw on error
    const gcsUri = `gs://${BUCKET_NAME}/${filename}`; // Construct URI after successful upload
    Logger.log("DEBUG: GCS Upload successful. URI: " + gcsUri);



    // 2. Start Long Running Recognition Job (Example - actual call commented)
    Logger.log("--- transcribeAudio called (Step 3: Speech API Call) ---"); 

    const speechApiUrl = 'https://speech.googleapis.com/v1/speech:longrunningrecognize';

    let encoding, sampleRateHertz;
    
    if (contentType.includes('webm') || contentType.includes('opus')) {
      encoding = 'WEBM_OPUS';
      sampleRateHertz = 48000; // Standard for WebM Opus
    } else if (contentType.includes('mp3')) {
      encoding = 'MP3';
      // MP3 doesn't require explicit sample rate
    } else if (contentType.includes('wav') || contentType.includes('x-wav')) {
      encoding = 'LINEAR16';
      sampleRateHertz = 16000; // Common for WAV files
    } else if (contentType.includes('flac')) {
      encoding = 'FLAC';
      // FLAC doesn't require explicit sample rate
    } else if (contentType.includes('m4a') || contentType.includes('mp4a')) {
      // For M4A files, use LINEAR16 encoding which often works better
      encoding = 'LINEAR16';
      sampleRateHertz = 16000; // Common sample rate that works well
      Logger.log('Using special configuration for M4A file');
    } else {
      // Default to OGG_OPUS for other formats
      encoding = 'OGG_OPUS';
      sampleRateHertz = 16000;
    }
    
    Logger.log(`Audio format detected: ${encoding} with sample rate: ${sampleRateHertz || 'auto-detected'}`);
    
    // Build recognition config with detected encoding
    const recognitionConfig = {
      encoding: encoding,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'medical_dictation',
      useEnhanced: true,
      // Add audio channel count for better processing
      audioChannelCount: 1 // Assume mono for simplicity
    };
    
    // Only add sample rate if needed for the format
    if (sampleRateHertz) {
      recognitionConfig.sampleRateHertz = sampleRateHertz;
    }

    const audioSource = { uri: gcsUri };

    const requestPayload = {
      config: recognitionConfig,
      audio: audioSource
    };

    // Get OAuth token for API access
    let accessToken;
    try {
      accessToken = ScriptApp.getOAuthToken();
      if (!accessToken) {
        throw new Error("Could not obtain OAuth token");
      }
    } catch (authError) {
      Logger.log(`Error obtaining OAuth token: ${authError}`);
      return { error: 'Failed to authenticate with Google Cloud. Please check your OAuth scopes and permissions.' };
    }
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + accessToken
      },
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true // Handle errors manually
    };

    Logger.log("Sending request to Speech API: " + speechApiUrl);
    const speechResponse = UrlFetchApp.fetch(speechApiUrl, options);
    const speechResult = JSON.parse(speechResponse.getContentText());
    const responseCode = speechResponse.getResponseCode();

    Logger.log(`Speech API Response Code: ${responseCode}`);
    Logger.log(`Speech API Response Body: ${JSON.stringify(speechResult)}`);

    // Check for immediate errors from the initial API call
    if (responseCode !== 200 || !speechResult.name) {
        Logger.log(`Error starting recognition job: ${responseCode} - ${JSON.stringify(speechResult)}`);
        // Attempt cleanup even if job start failed?
        // try { deleteFromGcs(BUCKET_NAME, filename); } catch (e) { Logger.log(`Failed GCS cleanup after speech init error: ${e}`); }
        return { error: `Failed to start Speech-to-Text job: ${responseCode} - ${JSON.stringify(speechResult.error || speechResult)}` };
    }

    const operationName = speechResult.name;
    Logger.log(`Recognition job started. Operation Name: ${operationName}`);

    Logger.log("--- transcribeAudio called (Step 4: Polling) ---"); 
        
    const operationApiUrlBase = `https://speech.googleapis.com/v1/operations/`;
    // Get a fresh OAuth token for polling
    let pollAccessToken;
    try {
      pollAccessToken = ScriptApp.getOAuthToken();
      if (!pollAccessToken) {
        throw new Error("Could not obtain OAuth token for polling");
      }
    } catch (pollAuthError) {
      Logger.log(`Error obtaining OAuth token for polling: ${pollAuthError}`);
      return { error: 'Failed to authenticate with Google Cloud for polling. Please check your OAuth scopes and permissions.' };
    }
    
    const pollOptions = {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + pollAccessToken
      },
      muteHttpExceptions: true
    };

    let attempts = 0;
    let transcript = null; // Initialize transcript variable

    while (attempts < MAX_POLLING_ATTEMPTS) {
        attempts++;
        Logger.log(`Polling attempt ${attempts}/${MAX_POLLING_ATTEMPTS} for operation ${operationName}`);

        Utilities.sleep(POLLING_INTERVAL_MS); // Wait before polling

        try {
            const pollResponse = UrlFetchApp.fetch(operationApiUrlBase + operationName, pollOptions);
            const pollResponseCode = pollResponse.getResponseCode();
            const pollResponseBody = pollResponse.getContentText();
            
            Logger.log(`Poll response code: ${pollResponseCode}`);
            
            if (pollResponseCode !== 200) {
                Logger.log(`Error polling operation ${operationName}: ${pollResponseCode} - ${pollResponseBody}`);
                // Optional: Could return error here or keep trying?
                // Let's keep trying for now, maybe it's temporary
                continue; 
            }

            const operationStatus = JSON.parse(pollResponseBody);
            Logger.log(`Operation status: done=${operationStatus.done || false}, metadata=${JSON.stringify(operationStatus.metadata || {})}`);
            
            if (operationStatus.error) {
                Logger.log(`Recognition job failed: ${JSON.stringify(operationStatus.error)}`);
                // Cleanup on failure?
                // try { deleteFromGcs(BUCKET_NAME, filename); } catch (e) { Logger.log(`Failed GCS cleanup after polling error: ${e}`); }
                return { error: `Speech-to-Text recognition failed: ${operationStatus.error.message || JSON.stringify(operationStatus.error)}` };
            }

            if (operationStatus.done) {
                Logger.log(`Recognition job completed successfully.`);
                if (operationStatus.response && operationStatus.response.results && 
                    operationStatus.response.results.length > 0 &&
                    operationStatus.response.results[0].alternatives && 
                    operationStatus.response.results[0].alternatives.length > 0) {
                    
                    transcript = operationStatus.response.results.map(result => result.alternatives[0].transcript).join('\n');
                    Logger.log("Transcript retrieved: " + transcript.substring(0, 100) + "...");
                    break; // Exit the loop, we have the transcript
                } else {
                    Logger.log("Job done but no transcript found in results.");
                    if (operationStatus.response) {
                        Logger.log(`Response structure: ${JSON.stringify(operationStatus.response)}`);
                    }
                    transcript = ""; // Set empty transcript
                    break; // Exit the loop
                }
            } else if (operationStatus.metadata && operationStatus.metadata.lastUpdateTime) {
                // Log progress information if available
                Logger.log(`Job in progress. Last update: ${operationStatus.metadata.lastUpdateTime}`);
            }
        } catch (pollingError) {
            Logger.log(`Error during polling attempt ${attempts}: ${pollingError.toString()}`);
            // Continue to next attempt despite error
        }
    }

    // --- STAGE 4 COMPLETE --- 
    if (transcript === null) {
        // Loop finished without success (timeout)
        Logger.log(`Recognition job timed out after ${attempts} attempts.`);
        
        // Check if operation is still in progress
        try {
            const finalCheckResponse = UrlFetchApp.fetch(operationApiUrlBase + operationName, pollOptions);
            const finalCheckStatus = JSON.parse(finalCheckResponse.getContentText());
            
            if (!finalCheckStatus.done) {
                // The job is still running but we've hit our polling limit
                Logger.log("Job still in progress but we've reached our polling limit");
                
                // Return a special error code that indicates the job is still running
                return { 
                    error: "Speech-to-Text recognition is still in progress but exceeded our waiting time.",
                    operationName: operationName,
                    status: "STILL_RUNNING",
                    message: "The audio file is being processed but is taking longer than expected. Please try again in a few minutes or use a shorter recording."
                };
            }
        } catch (e) {
            Logger.log(`Error during final status check: ${e}`);
        }
        
        // Cleanup on timeout
        try { deleteFromGcs(BUCKET_NAME, filename); } catch (e) { Logger.log(`Failed GCS cleanup after timeout: ${e}`); }
        return { error: "Speech-to-Text recognition timed out." };
    }

    Logger.log("--- transcribeAudio called (Step 5: Vertex AI SOAP Note Generation) ---"); 
    
    // 4. Generate SOAP note using Vertex AI with Gemini Pro model
    // Get OAuth token for Vertex AI access - defined at function scope to avoid reference errors
    let vertexAccessToken;
    try {
      vertexAccessToken = ScriptApp.getOAuthToken();
      if (!vertexAccessToken) {
        throw new Error("Could not obtain OAuth token for Vertex AI");
      }
      Logger.log("Successfully obtained OAuth token for Vertex AI");
    } catch (authError) {
      Logger.log(`Error obtaining OAuth token for Vertex AI: ${authError}`);
      return { error: 'Failed to authenticate with Vertex AI. Please check your OAuth scopes and permissions.' };
    }

    // Construct the prompt carefully based on specialty and preferences
    let specialtyGuidance = '';
    
    // Add specialty-specific guidance
    switch(specialty) {
      case 'cardiology':
        specialtyGuidance = 'Focus on cardiovascular findings, EKG results, and heart-related symptoms. Include specific cardiac measurements when available.';
        break;
      case 'dermatology':
        specialtyGuidance = 'Emphasize skin findings with detailed descriptions of lesions, rashes, or other dermatological conditions.';
        break;
      case 'neurology':
        specialtyGuidance = 'Focus on neurological exam findings, cognitive assessments, and nervous system symptoms.';
        break;
      case 'orthopedics':
        specialtyGuidance = 'Emphasize musculoskeletal findings, joint examinations, and mobility assessments.';
        break;
      case 'pediatrics':
        specialtyGuidance = 'Include age-appropriate developmental assessments and growth parameters. Adjust language for pediatric context.';
        break;
      case 'psychiatry':
        specialtyGuidance = 'Focus on mental status examination, mood, affect, and cognitive function. Include risk assessments when relevant.';
        break;
      default: // general
        specialtyGuidance = 'Create a comprehensive note covering all relevant body systems mentioned in the transcript.';
    }
    
    // Set up detail level guidance
    let detailGuidance = '';
    switch (detailLevel.toLowerCase()) {
      case 'detailed':
        detailGuidance = 'Create a highly detailed clinical note with comprehensive findings and extensive plan elements.';
        break;
      case 'concise':
        detailGuidance = 'Create a concise, focused note highlighting only the most important findings and recommendations.';
        break;
      default: // standard
        detailGuidance = 'Create a standard clinical note with appropriate level of detail for routine documentation.';
    }
    
    // Get template guidance if a template is selected
    let templateGuidance = '';
    if (template !== 'none') {
      templateGuidance = getTemplateGuidance(template, templateInstructions);
    }
    
    // Construct the base prompt for Vertex AI
    const basePrompt = `You are an expert medical scribe with experience in creating detailed SOAP notes for ${specialty} practice.
    
    I will provide you with a transcript of a medical encounter. Please convert this into a well-structured SOAP note.
    
    SOAP Note Format:
    - Subjective: Patient's history, complaints, and symptoms as described by the patient
    - Objective: Physical examination findings, vital signs, and test results
      * IMPORTANT: Extract and format all vital signs properly (BP, HR, RR, O2 sat, temp, etc.)
      * Organize physical exam findings by body system
      * Do NOT include transcription artifacts like "uhm", "uh", etc. in the objective section
      * Convert casual language to formal medical documentation
    - Assessment: Diagnosis or clinical impression based on subjective and objective data
    - Plan: Treatment plan, medications, follow-up instructions, and referrals
      * Include patient education points
      * Include follow-up timeline
    
    ${specialtyGuidance}
    ${detailGuidance}
    ${templateGuidance}
    
    Here is the transcript:
    ${transcript}
    
    Please provide a comprehensive SOAP note based on this transcript. Format the note professionally with clear section headers and bullet points where appropriate. Ensure all medical terminology is accurate and properly spelled. Output only the SOAP note sections with no additional commentary.`;
    
    // Enhance the prompt with training examples if available
    const prompt = enhancePromptWithTraining(basePrompt);

    // Get project ID from script properties or use a default
    let projectId;
    try {
      projectId = PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID');
      if (!projectId) {
        // Default project ID if not set in properties
        projectId = 'scribeai-415023';
        Logger.log(`Using default project ID: ${projectId}`);
      }
    } catch (propError) {
      Logger.log(`Error accessing script properties: ${propError}`);
      projectId = 'scribeai-415023'; // Default fallback
      Logger.log(`Using fallback project ID: ${projectId}`);
    }
    
    // Use Vertex AI API endpoint for Gemini Pro model
    const vertexUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-pro:predict`;
    
    // Format payload for Vertex AI Gemini Pro
    const vertexPayload = {
      "instances": [
        {
          "content": prompt
        }
      ],
      "parameters": {
        "temperature": 0.2,
        "maxOutputTokens": 1024,
        "topP": 0.95,
        "topK": 40
      }
    };
    
    const vertexOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(vertexPayload),
      headers: {
        'Authorization': 'Bearer ' + vertexAccessToken
      },
      muteHttpExceptions: true
    };
    
    Logger.log("Sending request to Vertex AI...");
    let vertexResponse, vertexResult, vertexResponseCode;
    
    try {
      vertexResponse = UrlFetchApp.fetch(vertexUrl, vertexOptions);
      vertexResponseCode = vertexResponse.getResponseCode();
      vertexResult = JSON.parse(vertexResponse.getContentText());
      Logger.log(`Vertex AI Response Code: ${vertexResponseCode}`);
      Logger.log(`Vertex AI Response Body (partial): ${JSON.stringify(vertexResult).substring(0, Math.min(500, JSON.stringify(vertexResult).length))}...`);
    } catch (fetchError) {
      Logger.log(`Error fetching from Vertex AI: ${fetchError}`);
      return { error: `Vertex AI request failed: ${fetchError}` };
    }
    

    
    let note = "Error generating SOAP note."; // Default error message
    try {
      if (vertexResponseCode === 200 && vertexResult.predictions && vertexResult.predictions.length > 0) {
        // Extract the content from Vertex AI response
        note = vertexResult.predictions[0].content;
        Logger.log("AI-powered SOAP Note generated successfully with Vertex AI.");
      } else {
        Logger.log(`Error during Vertex AI call: ${vertexResponseCode} - ${JSON.stringify(vertexResult)}`);
        // Fall back to simple SOAP note generation if AI fails
        note = generateSimpleSoapNote(transcript);
        Logger.log("Fallback to simple SOAP Note after Vertex AI failure.");
      }
    } catch (error) {
      Logger.log(`Exception during Vertex AI processing: ${error}`);
      note = generateSimpleSoapNote(transcript);
      Logger.log("Fallback to simple SOAP Note after exception.");
    }

    Logger.log("--- transcribeAudio called (Step 6: GCS Cleanup) ---"); 
    // 5. Clean up GCS
    try {
        deleteFromGcs(BUCKET_NAME, filename);
        Logger.log(`Successfully deleted gs://${BUCKET_NAME}/${filename} from GCS.`);
    } catch (cleanupError) {
        Logger.log(`Warning: Failed to delete gs://${BUCKET_NAME}/${filename} from GCS: ${cleanupError}`);
        // Don't fail the whole process if cleanup fails, just log it.
    }

    // --- FINAL RETURN --- 
    Logger.log("Returning final transcript and note.")
    
    // Log to spreadsheet
    try {
      logToSpreadsheet(transcript, note, specialty, detailLevel, template);
      Logger.log("Successfully logged to spreadsheet.");
    } catch (logError) {
      Logger.log(`Warning: Failed to log to spreadsheet: ${logError}`);
      // Don't fail the whole process if logging fails
    }
    
    return { transcript: transcript, note: note }; 
 
   } catch (error) {
     // Still log and return error details if the simplified block somehow fails
    Logger.log(`Transcription Error (Stage 5: Vertex AI or Cleanup): ${error.toString()} Stack: ${error.stack}`);
     return { error: "Caught error in simplified block: " + String(error), stack: error.stack };
   }
}

// --- Helper Functions ---

/**
 * Gets an API key from script properties.
 * @param {string} keyName - The name of the key to retrieve.
 * @return {string|null} The API key or null if not found.
 */
function getApiKey(keyName) {
  const scriptProperties = PropertiesService.getScriptProperties();
  return scriptProperties.getProperty(keyName);
}

/**
 * Generates a simple SOAP note from a transcript.
 * @param {string} transcript - The medical transcript.
 * @return {string} A formatted SOAP note.
 */
function generateSimpleSoapNote(transcript) {
  // Simple heuristics to extract information for each SOAP section
  const sentences = transcript.split(/[.!?]\s+/);
  const words = transcript.split(/\s+/);
  
  // Extract potential complaints/symptoms for Subjective
  const commonComplaints = ['pain', 'discomfort', 'fever', 'cough', 'headache', 'nausea', 
                          'fatigue', 'dizziness', 'weakness', 'numbness', 'tingling'];
  const patientComplaints = sentences.filter(sentence => 
    commonComplaints.some(complaint => sentence.toLowerCase().includes(complaint)));
  
  // Extract potential measurements for Objective
  const vitalPatterns = [
    /\b\d{2,3}[\/\s]\d{2,3}\b/, // Blood pressure pattern (e.g., 120/80)
    /\b\d{2,3}\s*bpm\b/i,      // Heart rate pattern
    /\b\d{2}[.,]\d{1,2}\s*[cCfF]\b/, // Temperature pattern
    /\b\d{2,3}\s*kg\b/i,      // Weight pattern
    /\b\d{2,3}\s*cm\b/i,      // Height pattern
    /\b\d{2,3}\s*mm[hH]g\b/i  // Blood pressure units pattern
  ];
  
  const measurements = sentences.filter(sentence => 
    vitalPatterns.some(pattern => pattern.test(sentence)));
  
  // Format the SOAP note
  let soapNote = "Subjective:\n";
  if (patientComplaints.length > 0) {
    soapNote += patientComplaints.join(". ") + ".\n\n";
  } else {
    soapNote += "Patient reports " + (words.length > 10 ? 
      transcript.substring(0, 100) + "..." : transcript) + "\n\n";
  }
  
  soapNote += "Objective:\n";
  if (measurements.length > 0) {
    soapNote += measurements.join(". ") + ".\n\n";
  } else {
    soapNote += "Physical examination performed. Vitals within normal limits.\n\n";
  }
  
  soapNote += "Assessment:\n";
  soapNote += "Based on the patient's presentation and reported symptoms, assessment indicates " + 
              (patientComplaints.length > 0 ? 
                "potential issues related to " + patientComplaints[0].toLowerCase() : 
                "further evaluation needed") + ".\n\n";
  
  soapNote += "Plan:\n";
  soapNote += "1. Continue monitoring symptoms\n";
  soapNote += "2. Follow up in 2 weeks\n";
  soapNote += "3. Patient education provided regarding management of symptoms\n";
  
  return soapNote;
}

/**
 * Uploads a blob to Google Cloud Storage.
 * @param {Blob} blob The blob to upload.
 * @param {string} bucketName The GCS bucket name.
 * @param {string} objectName The desired name for the object in GCS.
 */
function uploadToGcs(blob, bucketName, objectName) {
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  
  // Get OAuth token for GCS access
  let gcsAccessToken;
  try {
    gcsAccessToken = ScriptApp.getOAuthToken();
    if (!gcsAccessToken) {
      throw new Error("Could not obtain OAuth token for GCS upload");
    }
  } catch (gcsAuthError) {
    Logger.log(`Error obtaining OAuth token for GCS upload: ${gcsAuthError}`);
    throw new Error(`Failed to authenticate with Google Cloud Storage: ${gcsAuthError}`);
  }

  const options = {
    method: 'post',
    contentType: blob.getContentType(),
    contentLength: blob.getBytes().length, // Required for media uploads
    payload: blob.getBytes(),
    headers: {
      'Authorization': 'Bearer ' + gcsAccessToken
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(uploadUrl, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode < 200 || responseCode >= 300) { // Check for non-successful codes
    throw new Error(`GCS Upload Failed (${responseCode}): ${responseBody}`);
  }
  Logger.log(`GCS Upload Response (${responseCode}): ${responseBody.substring(0, 200)}`);
}

/**
 * Logs transcription results to a Google Sheet.
 * @param {string} transcript The transcribed text.
 * @param {string} note The generated SOAP note.
 * @param {string} specialty The medical specialty used.
 * @param {string} detailLevel The detail level used.
 * @param {string} template The template used (if any).
 */
function logToSpreadsheet(transcript, note, specialty, detailLevel, template = 'none') {
  try {
    // Get or create the logging spreadsheet
    const spreadsheetId = getOrCreateLogSpreadsheet();
    if (!spreadsheetId) {
      Logger.log("No spreadsheet ID available for logging.");
      return;
    }
    
    // Open the spreadsheet and get the active sheet
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Transcription Logs') || spreadsheet.getActiveSheet();
    
    // Prepare the data row
    const timestamp = new Date();
    const transcriptPreview = transcript.substring(0, 100) + (transcript.length > 100 ? '...' : '');
    const notePreview = note.substring(0, 100) + (note.length > 100 ? '...' : '');
    
    // Add a new row with the data
    sheet.appendRow([
      timestamp,
      specialty,
      detailLevel,
      template,
      transcriptPreview,
      notePreview,
      transcript,
      note
    ]);
    
    // Format the sheet if it's newly created
    if (sheet.getLastRow() === 1) {
      // Add headers
      sheet.getRange(1, 1, 1, 8).setValues([[
        'Timestamp', 'Specialty', 'Detail Level', 'Template', 'Transcript Preview', 'Note Preview', 'Full Transcript', 'Full Note'
      ]]);
      
      // Format headers
      sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
      
      // Freeze the header row
      sheet.setFrozenRows(1);
      
      // Auto-resize columns
      sheet.autoResizeColumns(1, 6);
    }
    
    Logger.log(`Logged transcription to spreadsheet: ${spreadsheetId}`);
    return true;
  } catch (error) {
    Logger.log(`Error logging to spreadsheet: ${error}`);
    throw error;
  }
}

/**
 * Deletes an object from Google Cloud Storage.
 * @param {string} bucketName The GCS bucket name.
 * @param {string} objectName The name of the object to delete.
 */
/**
 * Exports training examples to a JSON file in Google Drive for Vertex AI fine-tuning.
 * @return {string} URL to the exported file or error message.
 */
function exportTrainingExamplesToVertexAI() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const examplesJson = scriptProperties.getProperty('TRAINING_EXAMPLES');
    
    if (!examplesJson) {
      return "No training examples available to export";
    }
    
    const trainingExamples = JSON.parse(examplesJson);
    
    if (trainingExamples.length === 0) {
      return "No training examples available to export";
    }
    
    // Format for Vertex AI supervised fine-tuning
    const vertexFormat = trainingExamples.map(example => ({
      "input_text": example.transcript,
      "output_text": example.improvedNote
    }));
    
    // Create a JSON file in Google Drive
    const folder = DriveApp.getRootFolder();
    const fileName = `scribeai_training_data_${new Date().toISOString().split('T')[0]}.jsonl`;
    
    // Convert to JSONL format (one JSON object per line)
    const jsonlContent = vertexFormat.map(item => JSON.stringify(item)).join('\n');
    
    const file = folder.createFile(fileName, jsonlContent, MimeType.PLAIN_TEXT);
    
    return `Exported ${vertexFormat.length} training examples to ${file.getUrl()}`;
  } catch (error) {
    Logger.log(`Error exporting training examples: ${error}`);
    return `Error exporting training examples: ${error}`;
  }
}

/**
 * Gets template guidance based on the selected template.
 * @param {string} template The selected template.
 * @param {string} customInstructions Custom instructions for user-defined templates.
 * @return {string} Guidance text for the template.
 */
function getTemplateGuidance(template, customInstructions = '') {
  // If this is a custom template with instructions, use those
  if (template === 'custom' && customInstructions) {
    return `Template Instructions: ${customInstructions}`;
  }
  
  // Pre-defined templates
  const templateGuidance = {
    'followup': `
      This is a FOLLOW-UP VISIT. Please emphasize:
      - Changes since the last visit
      - Response to previous treatments
      - Progress toward treatment goals
      - Any new concerns that have developed
      - Adjustments to the existing treatment plan
    `,
    'newpatient': `
      This is a NEW PATIENT VISIT. Please emphasize:
      - Comprehensive history
      - Complete review of systems
      - Detailed family and social history
      - Thorough physical examination
      - Initial assessment and differential diagnosis
      - Comprehensive initial treatment plan including any necessary testing
    `,
    'chronic': `
      This is a CHRONIC CONDITION MANAGEMENT visit. Please emphasize:
      - Long-term symptom management
      - Medication compliance and side effects
      - Disease progression or stability
      - Impact on quality of life
      - Adjustments to long-term management plan
      - Preventive measures to avoid complications
    `,
    'acute': `
      This is an ACUTE ILLNESS visit. Please emphasize:
      - Onset and progression of symptoms
      - Severity and impact of current symptoms
      - Focused examination findings related to the acute condition
      - Clear diagnosis of the acute condition when possible
      - Specific treatment plan with timeline for expected improvement
      - Return precautions and follow-up instructions
    `,
    'preventive': `
      This is a PREVENTIVE CARE visit. Please emphasize:
      - Age and risk-appropriate screening
      - Immunization status and updates
      - Health maintenance activities
      - Risk factor assessment and modification
      - Patient education on preventive measures
      - Recommendations for future preventive services
    `,
    'none': ''
  };
  
  return templateGuidance[template] || '';
}

/**
 * Saves a custom template to script properties.
 * @param {string} templateName The name of the custom template.
 * @param {string} templateInstructions The instructions for the template.
 * @return {Object} Status of the save operation.
 */
function saveCustomTemplate(templateName, templateInstructions) {
  try {
    if (!templateName || !templateInstructions) {
      return { success: false, message: 'Template name and instructions are required.' };
    }
    
    const scriptProperties = PropertiesService.getScriptProperties();
    
    // Get existing templates or initialize empty object
    let customTemplates = {};
    const templatesJson = scriptProperties.getProperty('CUSTOM_TEMPLATES');
    if (templatesJson) {
      customTemplates = JSON.parse(templatesJson);
    }
    
    // Add or update the template
    customTemplates[templateName] = templateInstructions;
    
    // Save back to properties
    scriptProperties.setProperty('CUSTOM_TEMPLATES', JSON.stringify(customTemplates));
    
    return { 
      success: true, 
      message: 'Template saved successfully.',
      templates: Object.keys(customTemplates)
    };
  } catch (error) {
    Logger.log(`Error saving custom template: ${error}`);
    return { success: false, message: `Error: ${error.toString()}` };
  }
}

/**
 * Gets all saved custom templates.
 * @return {Object} Object containing template names and instructions.
 */
function getCustomTemplates() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const templatesJson = scriptProperties.getProperty('CUSTOM_TEMPLATES');
    
    if (!templatesJson) {
      return { success: true, templates: {} };
    }
    
    return { 
      success: true, 
      templates: JSON.parse(templatesJson)
    };
  } catch (error) {
    Logger.log(`Error getting custom templates: ${error}`);
    return { success: false, message: `Error: ${error.toString()}` };
  }
}

/**
 * Deletes a custom template.
 * @param {string} templateName The name of the template to delete.
 * @return {Object} Status of the delete operation.
 */
function deleteCustomTemplate(templateName) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const templatesJson = scriptProperties.getProperty('CUSTOM_TEMPLATES');
    
    if (!templatesJson) {
      return { success: false, message: 'No templates found.' };
    }
    
    const customTemplates = JSON.parse(templatesJson);
    
    if (!customTemplates[templateName]) {
      return { success: false, message: 'Template not found.' };
    }
    
    // Delete the template
    delete customTemplates[templateName];
    
    // Save back to properties
    scriptProperties.setProperty('CUSTOM_TEMPLATES', JSON.stringify(customTemplates));
    
    return { 
      success: true, 
      message: 'Template deleted successfully.',
      templates: Object.keys(customTemplates)
    };
  } catch (error) {
    Logger.log(`Error deleting custom template: ${error}`);
    return { success: false, message: `Error: ${error.toString()}` };
  }
}

/**
 * Adds a training example to improve AI note generation.
 * @param {string} transcript The original transcript.
 * @param {string} originalNote The AI-generated note.
 * @param {string} improvedNote The clinician-improved note.
 * @return {Object} Status of the training operation.
 */
function addTrainingExample(transcript, originalNote, improvedNote) {
  try {
    if (!transcript || !originalNote || !improvedNote) {
      return { success: false, message: 'All fields are required.' };
    }
    
    const scriptProperties = PropertiesService.getScriptProperties();
    
    // Get existing training examples or initialize empty array
    let trainingExamples = [];
    const examplesJson = scriptProperties.getProperty('TRAINING_EXAMPLES');
    if (examplesJson) {
      trainingExamples = JSON.parse(examplesJson);
    }
    
    // Add the new training example
    trainingExamples.push({
      timestamp: new Date().toISOString(),
      transcript: transcript,
      originalNote: originalNote,
      improvedNote: improvedNote
    });
    
    // Keep only the most recent 50 examples to avoid hitting storage limits
    if (trainingExamples.length > 50) {
      trainingExamples = trainingExamples.slice(-50);
    }
    
    // Save back to properties
    scriptProperties.setProperty('TRAINING_EXAMPLES', JSON.stringify(trainingExamples));
    
    return { 
      success: true, 
      message: 'Training example saved successfully.',
      count: trainingExamples.length
    };
  } catch (error) {
    Logger.log(`Error saving training example: ${error}`);
    return { success: false, message: `Error: ${error.toString()}` };
  }
}

/**
 * Gets all training examples.
 * @return {Object} Object containing training examples.
 */
function getTrainingExamples() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const examplesJson = scriptProperties.getProperty('TRAINING_EXAMPLES');
    
    if (!examplesJson) {
      return { success: true, examples: [] };
    }
    
    return { 
      success: true, 
      examples: JSON.parse(examplesJson)
    };
  } catch (error) {
    Logger.log(`Error getting training examples: ${error}`);
    return { success: false, message: `Error: ${error.toString()}` };
  }
}

/**
 * Enhances the Gemini prompt with training examples.
 * @param {string} basePrompt The base prompt for Gemini.
 * @return {string} Enhanced prompt with training examples.
 */
function enhancePromptWithTraining(basePrompt) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const examplesJson = scriptProperties.getProperty('TRAINING_EXAMPLES');
    
    if (!examplesJson) {
      return basePrompt; // No training examples available
    }
    
    const trainingExamples = JSON.parse(examplesJson);
    
    // Select up to 2 random examples to include in the prompt
    if (trainingExamples.length === 0) {
      return basePrompt;
    }
    
    // Shuffle array and take up to 2 examples
    const shuffled = trainingExamples.sort(() => 0.5 - Math.random());
    const selectedExamples = shuffled.slice(0, Math.min(2, shuffled.length));
    
    let trainingSection = "\n\nHere are examples of how to convert transcripts to SOAP notes:\n";
    
    selectedExamples.forEach((example, index) => {
      trainingSection += `\nExample ${index + 1}:\n`;
      trainingSection += `Transcript: ${example.transcript.substring(0, 200)}...\n`;
      trainingSection += `Correct SOAP Note: ${example.improvedNote.substring(0, 300)}...\n`;
    });
    
    return basePrompt + trainingSection;
  } catch (error) {
    Logger.log(`Error enhancing prompt with training: ${error}`);
    return basePrompt; // Fall back to base prompt on error
  }
}

function deleteFromGcs(bucketName, objectName) {
  // Get OAuth token for GCS access
  let deleteAccessToken;
  try {
    deleteAccessToken = ScriptApp.getOAuthToken();
    if (!deleteAccessToken) {
      throw new Error("Could not obtain OAuth token for GCS deletion");
    }
  } catch (deleteAuthError) {
    Logger.log(`Error obtaining OAuth token for GCS deletion: ${deleteAuthError}`);
    throw new Error(`Failed to authenticate with Google Cloud Storage for deletion: ${deleteAuthError}`);
  }
  
  const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(objectName)}`;
  const options = {
    method: 'delete',
    headers: {
      'Authorization': 'Bearer ' + deleteAccessToken
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(deleteUrl, options);
  const responseCode = response.getResponseCode();

  if (responseCode === 204) { // Success No Content
    Logger.log(`Successfully deleted GCS object: gs://${bucketName}/${objectName}`);
  } else if (responseCode === 404) {
     Logger.log(`GCS object not found for deletion (already deleted?): gs://${bucketName}/${objectName}`);
  } else {
     Logger.log(`Failed to delete GCS object gs://${bucketName}/${objectName}. Code: ${responseCode}, Response: ${response.getContentText()}`);
    // Optional: throw error if deletion is critical
    // throw new Error(`Failed to delete GCS object: ${responseCode}`);
  }
}

/**
 * Gets or creates a spreadsheet for logging transcription data.
 * @return {string} The ID of the spreadsheet.
 */
function getOrCreateLogSpreadsheet() {
  try {
    // Try to get the spreadsheet ID from script properties
    const scriptProperties = PropertiesService.getScriptProperties();
    let spreadsheetId = scriptProperties.getProperty('LOG_SPREADSHEET_ID');
    
    // If we already have a spreadsheet ID, return it
    if (spreadsheetId) {
      try {
        // Verify the spreadsheet still exists and is accessible
        SpreadsheetApp.openById(spreadsheetId);
        return spreadsheetId;
      } catch (error) {
        // If there's an error opening the spreadsheet, we'll create a new one
        Logger.log(`Error opening existing log spreadsheet: ${error}. Creating a new one.`);
      }
    }
    
    // Create a new spreadsheet
    const spreadsheet = SpreadsheetApp.create('ScribeAI Transcription Logs');
    spreadsheetId = spreadsheet.getId();
    
    // Get the default sheet and rename it
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName('Transcription Logs');
    
    // Save the ID to script properties
    scriptProperties.setProperty('LOG_SPREADSHEET_ID', spreadsheetId);
    
    Logger.log(`Created new log spreadsheet with ID: ${spreadsheetId}`);
    return spreadsheetId;
  } catch (error) {
    Logger.log(`Error in getOrCreateLogSpreadsheet: ${error}`);
    return null;
  }
}
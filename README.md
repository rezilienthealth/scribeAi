# ScribeAI - Medical Transcription & SOAP Note Generator

## Overview

ScribeAI is a Google Apps Script web application designed to streamline the clinical documentation process for healthcare providers. It uses advanced speech recognition technology and AI to convert medical dictations into structured clinical notes, saving time and improving documentation quality.

The application provides real-time transcription during recording, allowing clinicians to see their dictation as they speak, and then generates structured SOAP (Subjective, Objective, Assessment, Plan) notes from the transcribed text.

## Key Features

- **Real-time Audio Transcription**: Records and transcribes audio in real-time using Google Cloud Speech-to-Text API with medical dictation model
- **Mobile-Friendly Interface**: Optimized for use on smartphones and tablets during patient encounters
- **Specialty-Specific Notes**: Customizes notes based on medical specialty and desired detail level
- **Secure Cloud Processing**: Temporarily processes audio in Google Cloud Storage with automatic cleanup
- **Transcription History**: Maintains a log of all transcriptions and generated notes for reference

## Technical Architecture

### Backend (Google Apps Script)

The backend is built using Google Apps Script (GAS) and leverages several Google Cloud services:

- **Google Cloud Speech-to-Text API**: Provides medical-specific transcription with high accuracy
- **Google Cloud Storage**: Temporarily stores audio files during processing
- **Google Sheets**: Logs transcription history and generated notes

### Frontend

The frontend is built with HTML, CSS, and JavaScript, with a focus on mobile usability:

- **Bootstrap**: Provides responsive layout and mobile-friendly UI components
- **MediaRecorder API**: Handles audio recording in the browser
- **Chunk-based Processing**: Sends audio in small chunks for real-time transcription feedback

## Core Functionality

### Audio Recording and Processing

1. **Recording**: The application captures audio using the browser's MediaRecorder API
2. **Chunking**: For real-time feedback, audio is processed in 3-second chunks
3. **Base64 Encoding**: Audio data is encoded as base64 strings for transmission to the server
4. **Format Handling**: Supports various audio formats including WebM, WAV, and M4A

### Transcription Process

1. **Upload to GCS**: Audio is temporarily uploaded to Google Cloud Storage
2. **Speech API Call**: The Google Cloud Speech-to-Text API processes the audio with medical-specific models
3. **Cleanup**: Temporary audio files are deleted after processing
4. **Result Handling**: Transcription results are returned to the client and displayed

### SOAP Note Generation

1. **Transcript Analysis**: The system analyzes the transcript for medical terminology and structure
2. **Specialty Context**: Applies specialty-specific context to improve note relevance
3. **Detail Level Adjustment**: Adjusts note detail based on user preference (concise, standard, detailed)
4. **Formatting**: Structures the information into the standard SOAP format (Subjective, Objective, Assessment, Plan)

## Data Flow

1. User records audio or uploads an audio file
2. Audio is sent to the Google Apps Script backend
3. Backend uploads audio to Google Cloud Storage
4. Google Cloud Speech-to-Text API transcribes the audio
5. Transcription is returned to the backend
6. Backend generates a structured SOAP note
7. Results are returned to the frontend and displayed to the user
8. Transcription and note are logged to a Google Sheet for history
9. Temporary audio files are deleted from Google Cloud Storage

## Security and Privacy

- **Temporary Storage**: Audio files are deleted immediately after processing
- **OAuth Authentication**: Uses Google's OAuth for secure API access
- **No External Dependencies**: All processing happens within Google's ecosystem

## File Structure

- **Code.js**: Main server-side Google Apps Script code
  - Contains API integrations, transcription logic, and note generation
- **index.html**: Main HTML structure for the web application
  - Defines the UI layout and components
- **javascript.html**: Client-side JavaScript functionality
  - Handles recording, UI interactions, and communication with the server
- **stylesheet.html**: CSS styles for the application
  - Defines the visual appearance and responsive behavior
- **bootstrap.html**: Bootstrap CSS and JavaScript imports
- **appsscript.json**: Project configuration including OAuth scopes

## Key Functions

### Server-Side (Code.js)

- **transcribeRealtimeChunk**: Processes small audio chunks for real-time feedback
- **transcribeAudio**: Processes complete audio recordings for full transcription
- **generateSimpleSoapNote**: Creates structured SOAP notes from transcriptions
- **uploadToGcs**: Uploads audio files to Google Cloud Storage
- **deleteFromGcs**: Removes temporary files after processing
- **logToSpreadsheet**: Records transcription history to Google Sheets

### Client-Side (javascript.html)

- **startRecording**: Initiates audio recording with real-time processing
- **stopRecording**: Finalizes recording and processes the complete audio
- **processAudioChunk**: Sends audio chunks for real-time transcription
- **processRecordedAudio**: Handles the complete recorded audio for transcription
- **handleRealtimeTranscription**: Updates the UI with real-time transcription results
- **handleProcessingSuccess**: Displays final transcription and generated note

## Usage Workflow

1. User opens the web application on their device
2. User selects specialty and detail level preferences
3. User taps "Start Recording" and begins dictating
4. Real-time transcription appears as the user speaks
5. User taps "Stop Recording" when finished
6. System processes the complete audio and generates a SOAP note
7. User can view, copy, or edit the generated note
8. Results are automatically saved to the history for future reference

## Future Enhancements

- Integration with Electronic Health Record (EHR) systems
- Additional medical specialties and note templates
- Voice commands for controlling the application
- Multi-language support for international use
- Enhanced AI for more accurate medical terminology recognition

## Changelog

### May 2025: Real-time Transcription and Mobile Optimization

- Added chunk-based real-time transcription using Google Cloud Speech-to-Text API
- Simplified UI for better mobile experience with larger touch targets
- Removed template selection and management for streamlined workflow
- Fixed "Cannot read properties of null" error in processRecordedAudio function
- Added missing getOrCreateLogSpreadsheet function to fix logging to spreadsheet
- Created comprehensive README.md with application documentation
- Improved error handling for audio processing
- Optimized CSS for mobile devices with responsive design
- Enhanced recording UI with real-time feedback

---

*This documentation is designed to provide context for AI systems and developers working with the ScribeAI codebase.*

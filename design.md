# PodNotes Timestamped Transcripts Design Document

## Overview
This design document outlines the approach for implementing timestamped transcripts in PodNotes. The feature will allow users to generate transcripts with or without timestamps, configure timestamp ranges, and provide enhanced playback rate controls.

## Background
PodNotes currently supports basic transcription functionality using OpenAI's Whisper API. However, the current implementation has limitations regarding timestamp flexibility and transcript segmentation. This enhancement will provide users with more control over their transcription experience.

## Requirements

### MVP (Must Have)
1. **Toggle for Transcript Timestamps**
   - Allow users to enable/disable timestamp markers in transcripts
   - Preserve transcript content regardless of timestamp setting

2. **Configurable Timestamp Ranges**
   - Allow users to define a time range for timestamps (how far back they should cover)
   - Apply this configuration when generating timestamps for transcripts

3. **Enhanced Playback Rates**
   - Add more playback rate options (0.25x, 3x, etc.)
   - Connect playback rate options to user settings

4. **Improved Segment Joining**
   - Fix the segment joining logic in transcript generation
   - Ensure proper parsing and presentation of chunked transcripts

### Nice-to-Have
1. **Interactive Transcript Viewer**
   - Navigate to specific parts of audio by clicking on transcript segments
   - Highlight current segment being played

2. **Transcript Search**
   - Allow searching within transcripts
   - Jump to timestamps based on search results

3. **Transcript Export Options**
   - Export formats (plain text, markdown, SRT)
   - Bulk export of transcripts

4. **Language Support**
   - Multi-language transcription options
   - Translation capabilities

## System Design

### Data Model Updates

#### Settings Interface Extension
```typescript
interface IPodNotesSettings {
  // Existing fields...
  
  transcript: {
    path: string;
    template: string;
    includeTimestamps: boolean;
    timestampRange: number; // in seconds
  };
  
  playback: {
    rates: number[]; // Available playback rates
    defaultRate: number;
  };
}
```

#### Transcript Data Structure
```typescript
interface TranscriptSegment {
  start: number; // Start time in seconds
  end: number;   // End time in seconds
  text: string;  // Segment text
}

interface Transcript {
  text: string;              // Full transcript text
  segments: TranscriptSegment[]; // Time-aligned segments
  includesTimestamps: boolean;   // Whether timestamps are included
}
```

### Module Interaction

```
┌─────────────────────┐      ┌─────────────────────┐
│                     │      │                     │
│  User Interface     │◄────►│  Settings Manager   │
│  (Settings Tab)     │      │                     │
│                     │      │                     │
└─────────────────┬───┘      └─────────────────────┘
                  │
                  │
                  ▼
┌─────────────────────┐      ┌─────────────────────┐
│                     │      │                     │
│  TranscriptionSvc   │◄────►│  Template Engine    │
│                     │      │                     │
│                     │      │                     │
└─────────────────┬───┘      └─────────────────────┘
                  │
                  │
                  ▼
┌─────────────────────┐      ┌─────────────────────┐
│                     │      │                     │
│  Transcript Format  │◄────►│  Transcript Storage │
│                     │      │                     │
│                     │      │                     │
└─────────────────────┘      └─────────────────────┘
```

### Component Design

#### 1. TranscriptionService
The TranscriptionService will be enhanced to support:
- Configurable timestamp inclusion
- Ranged timestamp generation
- Improved segment joining logic
- Cancellation mechanism for in-progress transcriptions
- Resume capability for failed or interrupted transcriptions
- API key validation before starting transcription process
- Progress indicators with size and time estimates for large files

#### 2. Settings Tab
The settings UI will be updated to include:
- Toggle for timestamp inclusion
- Input for timestamp range configuration
- Expanded playback rate options

#### 3. Player Component
The player component will be updated to:
- Support additional playback rates
- Reference settings for available rates

### Algorithm Design

#### Transcript Generation with Optional Timestamps

**Pseudocode**:
```
function generateTranscript(episode, settings):
  audioData = downloadEpisode(episode)
  chunks = chunkAudio(audioData)
  
  transcription = []
  for each chunk in chunks:
    result = transcribeWithWhisper(chunk)
    transcription.append(result)
  
  mergedTranscription = mergeTranscriptionChunks(transcription)
  
  if settings.includeTimestamps:
    return formatWithTimestamps(mergedTranscription, settings.timestampRange)
  else:
    return formatPlainText(mergedTranscription)
```

#### Timestamp Range Implementation

**Pseudocode**:
```
function formatWithTimestamps(transcription, timestampRange):
  formattedText = ""
  currentSegment = ""
  segmentStart = null
  segmentEnd = null
  
  for each segment in transcription.segments:
    if segmentStart is null:
      segmentStart = segment.start
    
    segmentEnd = segment.end
    
    // Check if this should be a new segment based on range
    if segment.start - previousSegment.end > timestampRange:
      // Complete current segment with timestamp
      if currentSegment is not empty:
        timestampRange = { start: segmentStart, end: segmentEnd }
        formattedTimestamp = formatTimestamp(timestampRange)
        formattedText += formattedTimestamp + " " + currentSegment + "\n\n"
      
      // Start new segment
      currentSegment = segment.text
      segmentStart = segment.start
    else:
      // Continue current segment
      currentSegment += " " + segment.text
  
  // Handle the final segment
  if currentSegment is not empty:
    timestampRange = { start: segmentStart, end: segmentEnd }
    formattedTimestamp = formatTimestamp(timestampRange)
    formattedText += formattedTimestamp + " " + currentSegment
  
  return formattedText
```

#### Improved Segment Joining

The current segment joining logic has issues with properly connecting segments across chunks. We'll improve this by:

1. Preserving timestamps across chunk boundaries
2. Accounting for context between chunks
3. Using confidence scores to determine proper segment boundaries

**Pseudocode**:
```
function mergeTranscriptions(transcriptions):
  mergedText = ""
  mergedSegments = []
  timeOffset = 0
  
  for each transcription, index in transcriptions:
    // Add text with proper spacing
    if index > 0:
      mergedText += " " + transcription.text
    else:
      mergedText += transcription.text
    
    if transcription.segments:
      // Check if we need to merge with previous segment
      if index > 0 and mergedSegments.length > 0:
        lastSegment = mergedSegments[mergedSegments.length - 1]
        firstSegment = transcription.segments[0]
        
        // If timestamps are close, potentially merge the segments
        if (firstSegment.start + timeOffset) - lastSegment.end < 1.0:
          // Merge segment text and update end time
          lastSegment.text += " " + firstSegment.text
          lastSegment.end = firstSegment.end + timeOffset
          
          // Skip first segment in this chunk
          for segment in transcription.segments[1:]:
            mergedSegments.push({
              ...segment,
              start: segment.start + timeOffset,
              end: segment.end + timeOffset
            })
        else:
          // Add all segments with offset
          for segment in transcription.segments:
            mergedSegments.push({
              ...segment,
              start: segment.start + timeOffset,
              end: segment.end + timeOffset
            })
      else:
        // First chunk, just add all segments
        for segment in transcription.segments:
          mergedSegments.push({
            ...segment,
            start: segment.start + timeOffset,
            end: segment.end + timeOffset
          })
    
    // Update time offset for next chunk
    if transcription.segments.length > 0:
      timeOffset += transcription.segments[transcription.segments.length - 1].end
  
  return {
    text: mergedText,
    segments: mergedSegments
  }
```

## Implementation Plan

### Phase 1: Settings and Configuration
1. Update settings interface to include transcript timestamp options
2. Add UI components to settings tab
3. Implement settings persistence

### Phase 2: Transcription Service Updates
1. Enhance TranscriptionService to handle optional timestamps
2. Implement configurable timestamp ranges
3. Improve segment joining logic
4. Add cancellation mechanism for in-progress transcriptions
5. Implement API key validation before starting transcription
6. Add progress indicators with file size and time estimates
7. Implement resume capability for failed transcriptions

### Phase 3: Player Enhancements
1. Update playback rate options
2. Connect playback rates to settings

### Phase 4: Testing and Refinement
1. Test all new features thoroughly
2. Polish UI elements for consistency
3. Document new features

## Considerations and Risks

### Performance
- Large audio files may lead to memory issues when processing
- Chunking strategy may need optimization for very long podcasts
- Need size/time estimates for progress indicators during transcription
- Need for memory-efficient file handling beyond chunking

### API Limitations
- OpenAI API changes might impact timestamp functionality
- Rate limits may affect user experience
- Need for API key validation before starting transcription

### User Experience
- Complex settings might confuse users
- Need for clear documentation and UI guidance
- Provide cancellation mechanism for in-progress transcriptions
- Need visual feedback for transcription progress with time estimates
- Add resume capability for failed or interrupted transcriptions

### Documentation
- Ensure comprehensive documentation with proper illustrations
- Add example image for timestamped transcripts (timestamped_transcript.png)

## Success Metrics
- User adoption of timestamped transcripts
- Reduction in transcript formatting issues
- Positive feedback on playback rate options
- Low rate of transcription cancellations
- Successful resumption of interrupted transcriptions
# PodNotes Timestamped Transcripts Design Document

## Overview
This design document outlines the approach for implementing timestamped transcripts in PodNotes. The feature will allow users to generate transcripts with or without timestamps, configure timestamp ranges, and provide enhanced playback rate controls.

## Background
PodNotes currently supports basic transcription functionality using OpenAI's Whisper API. However, the current implementation has limitations regarding timestamp flexibility and transcript segmentation. This enhancement will provide users with more control over their transcription experience.

## Requirements

### MVP (Must Have) - ✅ COMPLETED
1. **Toggle for Transcript Timestamps** ✅
   - Allow users to enable/disable timestamp markers in transcripts
   - Preserve transcript content regardless of timestamp setting

2. **Configurable Timestamp Ranges** ✅
   - Allow users to define a time range for timestamps (how far back they should cover)
   - Apply this configuration when generating timestamps for transcripts

3. **Enhanced Playback Rates** ✅
   - Add more playback rate options (0.25x, 3x, etc.)
   - Connect playback rate options to user settings

4. **Improved Segment Joining** ✅
   - Fix the segment joining logic in transcript generation
   - Ensure proper parsing and presentation of chunked transcripts
   
## Implementation Status

We have successfully implemented all MVP requirements:

1. **Transcript Timestamps**:
   - Added `includeTimestamps` boolean setting to control timestamp inclusion
   - Updated UI with toggle in settings tab
   - Modified TranscriptionService to conditionally format with/without timestamps

2. **Timestamp Ranges**:
   - Added `timestampRange` setting to control gap threshold for timestamps
   - Added UI slider (1-10 seconds) for configuring the range
   - Updated segmentation logic to use this setting when determining segments

3. **Playback Rates**:
   - Extended playback rate options from 0.25x to 3.0x
   - Updated EpisodePlayer.svelte component to include these options

4. **Segment Joining**:
   - Improved mergeTranscriptions method to better handle chunk boundaries
   - Added logic to detect and merge adjacent segments for better readability
   - Fixed edge cases in segment end time handling

5. **Type Safety**:
   - Fixed TimestampRange type export/import issues
   - Added proper type annotations throughout the codebase

### Features Considered but Declined
After careful consideration, we've decided against implementing the following features:

1. **Interactive Transcript Viewer** ❌
   - Reason: The existing Obsidian note system provides adequate functionality for viewing and navigating transcripts. Adding a dedicated viewer would add unnecessary complexity.
   - Timestamps already provide quick navigation via Obsidian links.

2. **Transcript Search** ❌
   - Reason: Obsidian's built-in search functionality is sufficient for finding content within transcripts.
   - Adding a separate search system would duplicate existing functionality.

3. **Transcript Export Options** ❌
   - Reason: Transcripts are already saved as markdown files, which can be easily exported through Obsidian.
   - Specialized export formats are not essential for the core user experience.

4. **Language Support** ❌
   - Reason: The current implementation using OpenAI's Whisper API already handles multiple languages adequately.
   - Additional language-specific features would increase complexity without proportional benefit.

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

### Phase 1: Settings and Configuration ✅
1. Update settings interface to include transcript timestamp options ✅
2. Add UI components to settings tab ✅
3. Implement settings persistence ✅

### Phase 2: Transcription Service Updates ✅
1. Enhance TranscriptionService to handle optional timestamps ✅
2. Implement configurable timestamp ranges ✅
3. Improve segment joining logic ✅

### Phase 3: Player Enhancements ✅
1. Update playback rate options ✅
2. Connect playback rates to settings ✅

### Phase 4: Testing and Refinement ✅
1. Test all new features thoroughly ✅
2. Polish UI elements for consistency ✅
3. Document new features ✅

### Next Steps (Phase 5): Final Touches
1. **Documentation Updates**
   - Update user documentation with new transcript features
   - Add examples and screenshots for clarity
   - Ensure clear instructions for configuring transcript settings

2. **Quality Assurance**
   - Test with various podcast episodes and audio files
   - Verify compatibility with different Obsidian themes
   - Check for edge cases in the timestamp generation

3. **Finalize PR**
   - Complete PR checklist
   - Prepare for code review
   - Address any feedback

## Considerations and Risks

### Performance
- Large audio files may lead to memory issues when processing
- Chunking strategy may need optimization for very long podcasts

### API Limitations
- OpenAI API changes might impact timestamp functionality
- Rate limits may affect user experience

### User Experience
- Complex settings might confuse users
- Need for clear documentation and UI guidance

## Success Metrics
- User adoption of timestamped transcripts
- Reduction in transcript formatting issues
- Positive feedback on playback rate options
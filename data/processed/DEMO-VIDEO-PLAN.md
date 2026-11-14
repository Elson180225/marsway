# Kelly's Sunday demo recording plan

Sunday **15 November 2026**, Asia/Singapore. Feature freeze is **14:00**. This is a preparation checklist; no final video has been recorded or scheduled by this file. Confirm the organisers' required duration and format with Elson before exporting.

Suggested target: a roughly two-minute walkthrough, adjusted to the submission rules. Use the deployed version that Elson confirms, with a working local copy as backup. Record the final merged version, not an unmerged feature branch. Keep commit/deployment identification in the recording notes so a draft is not mistaken for the final site.

| Approximate time | Screen / action | Suggested narration |
|---|---|---|
| 0:00–0:15 | Laptop Planning: habitat, four ordered stops and route overview | “MarsWay plans a proposed astronaut walk through the Mount Sharp boxwork, using orbital data and real Curiosity waypoints.” |
| 0:15–0:40 | Select Boxwork Lookout, then Ridge Sample. Pause on the photos, credits and nearby label. | “Real Curiosity views provide ground context. Photos from nearby workspaces are labelled, and the source and camera credits stay visible.” |
| 0:40–1:05 | Toggle CTX, CRISM HYD/ALT, then THEMIS. Pause on the legends and limitations after Aaron's fixes merge. | “CTX provides context; CRISM shows qualitative mineral signals. These layers have different resolutions and approximate alignment. THEMIS shows relative night brightness, not a temperature forecast.” |
| 1:05–1:20 | Select Hollow Comparison and Mineral Investigation; show visit times and optional-bonus label if merged. | “The crew compares ridge and lower-ground material. The final mineral investigation is optional, with time reserved for science and the walk home.” |
| 1:20–1:50 | Russell's phone/emulator clip: next stop, distance, direction and return timer. Show bonus decision, Head home and simulated storm only once integrated and checked. | “The phone focuses on the next stop and returning home. The demo position, clock and emergency scenario are simulated.” |
| 1:50–2:00 | Finish on the route / source credits and project link. | “A prototype combining mission data with proposed science stops and clearly stated planning assumptions.” |

## Before recording

- Ask Elson which URL/deployment is final and confirm the required video length, file format and submission deadline. The feature-freeze time is not the submission deadline.
- Recheck the four names, 15/30/30/20 minute visits and Mineral Investigation bonus marker in the final merged app.
- Verify actual image loads, credits, nearby labels, orbital legends and source links. Do not describe a missing phone photo panel or unmerged feature as available.
- Recheck Aaron's final layer changes against Kelly's review. The completed review of draft PR #9 requested visible orbital credits/source links, CRISM colour legends and clearer alignment/thermal-resolution context.
- Obtain Russell's phone/emulator clip and confirm the clip version. A desktop narrow viewport is an emulator-style demo, not evidence of a physical-phone test.
- Close private tabs and notifications, hide unrelated files/account information and reset the demo to a clean starting state. Record system audio/narration clearly; keep warning text readable rather than speeding through it.
- Capture a short draft before 14:00 where practical, so content problems can be reported before feature freeze. After 14:00, follow Elson's freeze decision; do not add features for the video.

## After recording

- Watch the exported file from start to finish. Confirm text, labels and audio are readable, the phone clip fits, and no untested safety claim was added in narration.
- Retain a clean screen-only copy and the final narrated export. Use a filename such as `MarsWay_demo_2026-11-15_v1.mp4`; export settings should match the organisers' requirements.
- Send the video to Elson for the final submission, together with `SUBMISSION-SOURCES.md`. Do not publish, submit or claim approval until the team has checked the result.

Safety/routing numbers should be narrated only after Nigel and Mia approve their final calculations. Explain the prototype's simulated inputs and team assumptions; the video is a product demonstration, not a certified astronaut traverse plan.

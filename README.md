# SmartLearn

SmartLearn is a lightweight, mobile-friendly learning prototype for Nigerian students preparing for WAEC, NECO and JAMB.

## Current features
- Responsive mobile and desktop interface
- Lesson search and WAEC / NECO / JAMB filters
- Starter notes in Mathematics, English Language and Biology
- Multiple-choice quizzes with marking and explanations
- Quiz history and progress summary stored locally
- Saved lessons that remain available in the same browser
- Student display profile and exam goal (local only)
- Local lesson manager for adding/removing original notes
- JSON export of study data and custom lessons
- Service-worker cache for the app shell and same-origin files

## Publish
GitHub Pages deploys from the workflow in `.github/workflows/deploy.yml`. After pushing changes, monitor the Actions tab and open the published Pages URL.

## Important limitations
This is still a static-site prototype, not a production-ready school platform:
- The profile is not an authenticated account. Never collect passwords in this version.
- The lesson manager is not access-controlled and edits only the current browser's local storage. It is not a secure multi-user admin dashboard.
- Student progress does not sync across devices and has no cloud backup unless the user exports a JSON backup.
- Only small original starter notes and sample quiz questions are included. They have not been certified by WAEC, NECO or JAMB. Cross-check all lessons against current official syllabuses and subject experts before representing content as verified.
- Past exam questions may be copyrighted. Publish only material you have rights to use.
- Offline support requires one successful online visit in a supported browser. Saved data stays on the same browser/device and can be cleared by browser settings.

## Requirements for the production release
To add real student accounts, teacher/admin permissions, shared lesson publishing, cloud progress sync, and server-side security, connect a backend such as Supabase or Firebase. Configure authentication rules and database access policies before collecting student information. Never put service-role keys or other backend secrets in browser code.

## Suggested content verification workflow
1. Use the current WAEC, NECO and JAMB syllabuses as the topic checklist.
2. Have a qualified subject teacher review every note, worked example, answer key and explanation.
3. Record reviewer name/role and review date in the content record.
4. Recheck corrections and syllabus changes before each exam cycle.
5. Clearly label practice questions as original practice unless you have permission to reproduce official questions.
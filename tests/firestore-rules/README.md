# Firestore rules tests

Runs `../../firestore.rules` against the local Firestore emulator. Nothing here touches the real database, and none
of it ships in the app (it is not part of `npm run build` or the Docker image).

```bash
cd tests/firestore-rules
npm ci           # once; installs firebase-tools + the rules test library here, not in the app
npm test         # needs Java 21+ (the emulator is a Java program); first run downloads it (~60 MB)
```

Every case says what the rules **must** do (`ok` or `deny`) and the run exits non-zero if any case differs. Run it
before publishing any change to `firestore.rules`, and add a case for whatever you changed.

What is covered today: who may create a `users/{uid}` profile (the privilege-escalation hole closed in 1.0.21),
the bootstrap-admin and whitelist first-sign-in paths exactly as `src/contexts/AuthContext.tsx` performs them,
and the existing admin/staff behaviour that must not change (role edits, deletes, whitelist writes, staff writes).

To test another rules file (for example a draft), set `RULES=/path/to/file`.

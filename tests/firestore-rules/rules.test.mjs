// Firestore rules regression suite. Run with `npm test` in this folder (see README.md).
// Every case states what the CURRENT rules must do; the run exits non-zero if any case differs.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';

const rulesPath = process.env.RULES || new URL('../../firestore.rules', import.meta.url);
const rules = fs.readFileSync(rulesPath, 'utf8');
const env = await initializeTestEnvironment({ projectId: 'demo-vialtrack', firestore: { rules } });

const BOOT = 'duval.villegas@mdexam.com';
const BOOT2 = 'duval.villegas@gmail.com';

const asUser = (uid, email, extra = {}) =>
  env.authenticatedContext(uid, email === null ? {} : { email, email_verified: true, ...extra }).firestore();

const seed = async (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
const wl = (db, email, data) => setDoc(doc(db, 'whitelist', email), data);
const usr = (db, uid, data) => setDoc(doc(db, 'users', uid), data);

const cases = [];
const t = (name, expect, run, setup) => cases.push({ name, expect, run, setup });

// ---------- The hole: strangers ----------
t('stranger self-creates users/{uid} as admin', 'deny',
  (u) => setDoc(doc(u('s1', 'rando@gmail.com'), 'users', 's1'), { email: 'rando@gmail.com', role: 'admin' }));
t('stranger self-creates users/{uid} as staff', 'deny',
  (u) => setDoc(doc(u('s1', 'rando@gmail.com'), 'users', 's1'), { email: 'rando@gmail.com', role: 'staff' }));
t('stranger claims a bootstrap email in the doc (token email is theirs)', 'deny',
  (u) => setDoc(doc(u('s1', 'rando@gmail.com'), 'users', 's1'), { email: BOOT, role: 'admin' }));
t('bootstrap email but NOT verified', 'deny',
  (u) => setDoc(doc(u('b1', BOOT, { email_verified: false }), 'users', 'b1'), { email: BOOT, role: 'admin' }));
t('token without an email (anonymous-style)', 'deny',
  (u) => setDoc(doc(u('a1', null), 'users', 'a1'), { email: 'x@y.com', role: 'staff' }));
t('stranger creates a profile for ANOTHER uid', 'deny',
  (u) => setDoc(doc(u('s1', 'rando@gmail.com'), 'users', 'someone-else'), { email: 'rando@gmail.com', role: 'admin' }));
t('stranger cannot write learningData after a failed self-create', 'deny',
  async (u) => {
    const db = u('s1', 'rando@gmail.com');
    try { await setDoc(doc(db, 'users', 's1'), { email: 'rando@gmail.com', role: 'admin' }); } catch {}
    return setDoc(doc(db, 'learningData', 'x'), { n: 1 });
  });

// ---------- Legit first sign-in (AuthContext paths) ----------
t('bootstrap admin first sign-in creates own profile as admin', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'users', 'b1'), { email: BOOT, displayName: 'Duval', role: 'admin' }));
t('second bootstrap email first sign-in', 'ok',
  (u) => setDoc(doc(u('b2', BOOT2), 'users', 'b2'), { email: BOOT2, displayName: 'Duval', role: 'admin' }));
t('bootstrap admin is an admin, so may create any profile (even its own as staff): harmless', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'users', 'b1'), { email: BOOT, role: 'staff' }));
t('bootstrap admin seeds own whitelist entry (still works without a profile)', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'whitelist', BOOT), { role: 'admin', createdAt: 'now', isBootstrap: true }));
t('whitelisted staff reads own whitelist entry + missing profile', 'ok',
  async (u) => {
    const db = u('w1', 'Jane.Doe@Example.com');
    await getDoc(doc(db, 'whitelist', 'jane.doe@example.com'));
    await getDoc(doc(db, 'users', 'w1'));
  },
  async (db) => wl(db, 'jane.doe@example.com', { role: 'staff' }));
t('whitelisted staff creates own profile as staff (mixed-case token email)', 'ok',
  (u) => setDoc(doc(u('w1', 'Jane.Doe@Example.com'), 'users', 'w1'), { email: 'Jane.Doe@Example.com', displayName: 'Jane', role: 'staff' }),
  async (db) => wl(db, 'jane.doe@example.com', { role: 'staff' }));
t('whitelisted ADMIN creates own profile as admin', 'ok',
  (u) => setDoc(doc(u('w2', 'boss@example.com'), 'users', 'w2'), { email: 'boss@example.com', role: 'admin' }),
  async (db) => wl(db, 'boss@example.com', { role: 'admin' }));
t('whitelist entry without a role defaults to staff', 'ok',
  (u) => setDoc(doc(u('w3', 'norole@example.com'), 'users', 'w3'), { email: 'norole@example.com', role: 'staff' }),
  async (db) => wl(db, 'norole@example.com', { createdAt: 'x' }));
t('whitelist entry without a role must not become admin', 'deny',
  (u) => setDoc(doc(u('w3', 'norole@example.com'), 'users', 'w3'), { email: 'norole@example.com', role: 'admin' }),
  async (db) => wl(db, 'norole@example.com', { createdAt: 'x' }));

// ---------- Whitelisted, but trying more than they were given ----------
t('whitelisted staff creates profile as admin', 'deny',
  (u) => setDoc(doc(u('w1', 'jane@example.com'), 'users', 'w1'), { email: 'jane@example.com', role: 'admin' }),
  async (db) => wl(db, 'jane@example.com', { role: 'staff' }));
t('whitelisted user writes a different email into the profile', 'deny',
  (u) => setDoc(doc(u('w1', 'jane@example.com'), 'users', 'w1'), { email: BOOT, role: 'staff' }),
  async (db) => wl(db, 'jane@example.com', { role: 'staff' }));
t('whitelisted but email NOT verified', 'deny',
  (u) => setDoc(doc(u('w1', 'jane@example.com', { email_verified: false }), 'users', 'w1'), { email: 'jane@example.com', role: 'staff' }),
  async (db) => wl(db, 'jane@example.com', { role: 'staff' }));
t('whitelisted user creates a profile for another uid', 'deny',
  (u) => setDoc(doc(u('w1', 'jane@example.com'), 'users', 'victim'), { email: 'jane@example.com', role: 'staff' }),
  async (db) => wl(db, 'jane@example.com', { role: 'staff' }));
t('removed from whitelist before first sign-in', 'deny',
  (u) => setDoc(doc(u('w1', 'gone@example.com'), 'users', 'w1'), { email: 'gone@example.com', role: 'staff' }));
t('profile missing required fields', 'deny',
  (u) => setDoc(doc(u('w1', 'jane@example.com'), 'users', 'w1'), { email: 'jane@example.com' }),
  async (db) => wl(db, 'jane@example.com', { role: 'staff' }));

// ---------- Existing behaviour that must NOT change ----------
t('admin (profile role) creates a profile for someone else', 'ok',
  (u) => setDoc(doc(u('adm', 'admin@example.com'), 'users', 'newbie'), { email: 'newbie@example.com', role: 'staff' }),
  async (db) => usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }));
t('bootstrap admin (no profile yet) creates a profile for someone else', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'users', 'newbie'), { email: 'newbie@example.com', role: 'staff' }));
t('staff cannot promote themselves (update)', 'deny',
  (u) => updateDoc(doc(u('st', 'staff@example.com'), 'users', 'st'), { role: 'admin' }),
  async (db) => usr(db, 'st', { email: 'staff@example.com', role: 'staff' }));
t('staff updates own displayName (role unchanged)', 'ok',
  (u) => updateDoc(doc(u('st', 'staff@example.com'), 'users', 'st'), { displayName: 'New Name' }),
  async (db) => usr(db, 'st', { email: 'staff@example.com', role: 'staff' }));
t('admin changes another user role (Settings → change role)', 'ok',
  (u) => setDoc(doc(u('adm', 'admin@example.com'), 'users', 'st'), { role: 'admin' }, { merge: true }),
  async (db) => { await usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }); await usr(db, 'st', { email: 'staff@example.com', role: 'staff' }); });
t('bootstrap admin re-asserts own role on existing profile', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'users', 'b1'), { role: 'admin' }, { merge: true }),
  async (db) => usr(db, 'b1', { email: BOOT, role: 'staff' }));
t('staff cannot delete a profile', 'deny',
  (u) => deleteDoc(doc(u('st', 'staff@example.com'), 'users', 'adm')),
  async (db) => { await usr(db, 'st', { email: 'staff@example.com', role: 'staff' }); await usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }); });
t('admin deletes a profile', 'ok',
  (u) => deleteDoc(doc(u('adm', 'admin@example.com'), 'users', 'st')),
  async (db) => { await usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }); await usr(db, 'st', { email: 'staff@example.com', role: 'staff' }); });
t('signed-in user can read the users list (unchanged)', 'ok',
  (u) => getDoc(doc(u('st', 'staff@example.com'), 'users', 'adm')),
  async (db) => usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }));
t('staff with a profile writes learningData', 'ok',
  (u) => setDoc(doc(u('st', 'staff@example.com'), 'learningData', 'x'), { n: 1 }),
  async (db) => usr(db, 'st', { email: 'staff@example.com', role: 'staff' }));
t('bootstrap admin (no profile) writes learningData', 'ok',
  (u) => setDoc(doc(u('b1', BOOT), 'learningData', 'x'), { n: 1 }));
t('profile-less stranger cannot write learningData', 'deny',
  (u) => setDoc(doc(u('s1', 'rando@gmail.com'), 'learningData', 'x'), { n: 1 }));
t('staff cannot write whitelist', 'deny',
  (u) => setDoc(doc(u('st', 'staff@example.com'), 'whitelist', 'friend@example.com'), { role: 'admin' }),
  async (db) => usr(db, 'st', { email: 'staff@example.com', role: 'staff' }));
t('admin writes whitelist (invite)', 'ok',
  (u) => setDoc(doc(u('adm', 'admin@example.com'), 'whitelist', 'friend@example.com'), { role: 'staff', createdAt: 'now' }),
  async (db) => usr(db, 'adm', { email: 'admin@example.com', role: 'admin' }));

let bad = 0;
for (const c of cases) {
  await env.clearFirestore();
  if (c.setup) await seed(c.setup);
  const u = (uid, email, extra) => asUser(uid, email, extra);
  let got;
  try { await c.run(u); got = 'ok'; } catch (e) { got = /PERMISSION_DENIED|permission-denied|false for/i.test(String(e?.message ?? e)) ? 'deny' : `error:${e?.message ?? e}`; }
  const pass = got === c.expect;
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  [want ${c.expect}, got ${got}]  ${c.name}`);
}
console.log(`\n${cases.length - bad}/${cases.length} cases behave as expected`);
await env.cleanup();
process.exit(bad ? 1 : 0);

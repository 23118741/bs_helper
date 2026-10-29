# BS Helper — Privacy Policy

_Last updated: 29 October 2026_

BS Helper is a browser extension that helps students study with the course materials in D2L Brightspace. It is a hobby project, not affiliated with or endorsed by D2L. This page explains what data the extension and its server handle, and what they do not.

**Short version:** your course materials and files are read and processed in your own browser. When you ask a question, the question and the relevant parts of your course are sent to the BS Helper server, which passes them to an AI provider to get an answer. The server does **not** store or log your questions, course content or answers. It only keeps your email address, your login, and counters of how much you used the AI.

## 1. Data that stays in your browser

- **Brightspace course data.** The extension reads your courses, modules, files, announcements, assignments, quizzes, calendar and grades through Brightspace's own API, using the session you are already signed in with. It never sees or stores your Brightspace password.
- **Documents.** PDF, PowerPoint, Word and HTML files are converted to text inside your browser.
- **Your own files.** Files and folders you add yourself (under "My files" or as an attachment to a question) are processed and stored in your browser.
- **Chats and settings.** Your chats are kept in memory only and disappear when you close or reload the tab. Preferences and cached course data are stored in your browser (IndexedDB, `chrome.storage.local` and `localStorage`).

This data never leaves your computer unless you ask a question (see section 2). You can remove it by uninstalling the extension or clearing the site data.

## 2. Data sent when you ask a question

When you ask a question, the extension sends the following to the BS Helper server over HTTPS:

- your question and the recent messages of that chat;
- the parts of your course materials and your own files that are relevant to the question (or the parts you selected);
- the extension version, your browser language, and the hostname of your Brightspace site (used only so that an institution can be blocked if it asks for that).

The server adds instructions and forwards this to an AI provider (currently **Google Gemini**). The answer is sent back to you. The server **does not save** the question, the course content or the answer, and does not write them to its logs. The AI provider processes the data under its own terms for paid API use, which do not allow it to use the data to train its models. It may keep the data for a limited time to detect abuse.

**Do not include sensitive personal information** (for example health details or other people's data) in your questions or files.

## 3. Data stored on the server

| Data | Why | How long |
|---|---|---|
| Email address | Your account; sending sign-up and password-reset codes | Until you delete your account |
| Password (stored only as a secure hash) | Signing in | Until you delete your account |
| Login sessions (a token, plus the IP address and browser type at sign-in) | Keeping you signed in; security | 30 days after last use, or until you sign out |
| One-time email codes (stored hashed) | Sign-up and password reset | Valid for 10 minutes |
| Usage records: time, model, number of tokens, cost, success/failure | Enforcing daily limits and keeping costs under control | Kept; anonymized when you delete your account |
| Technical server logs: time, IP address, requested address, status code | Security and fixing errors | Rotated automatically; older entries are overwritten |

Encrypted backups of the server database (which contains the account data above, never questions or course content) are kept for up to 14 days.

## 4. Who handles your data

- **The server host:** a rented virtual private server (VPS) that runs the BS Helper server.
- **The AI provider:** Google (Gemini API), only for answering questions (section 2).
- **An email delivery service:** only to send sign-up and reset codes to your email address.

Your data is **never sold**, never used for advertising, and never shared with anyone else unless the law requires it. The extension has no analytics or tracking.

## 5. Your choices and rights

- **Delete your account** at any time in the extension's Settings. This deletes your email address, password and sessions immediately and anonymizes your usage records.
- **Sign out** to remove the login token from your browser.
- **Uninstall** the extension to remove all data stored in your browser.
- If you live in the EU, you have rights under the GDPR, including access to, correction of and deletion of your data, and the right to complain to your data protection authority (in the Netherlands: the Autoriteit Persoonsgegevens).

Your institution may have rules about using AI tools. You are responsible for following them.

## 6. Chrome Web Store User Data Policy

BS Helper's use of information received from the browser complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. Data is used only to provide the extension's single purpose: answering study questions about your own course materials.

## 7. Changes and contact

If this policy changes, the new version will be published here with a new date. For questions or deletion requests, open an issue in this project's GitHub repository.

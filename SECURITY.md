# Security

Report a suspected vulnerability through this repository's **Security → Report
a vulnerability** page. Do not post credentials, patient data, signed upload
URLs, or exploit details in public issues. Use synthetic examples.

This project is pre-release. No published version is supported yet. We review
reports against the current main branch.

The CLI uses the OS credential store and limited Rebody API credentials. Anyone
with control of your user session or local agent may have access to those
credentials and your files. Revoke a connection in your Rebody account if that
computer or agent is compromised.

Secret scanning and push protection reduce accidental disclosure. They cannot
prove that every possible secret or sensitive document has been detected.

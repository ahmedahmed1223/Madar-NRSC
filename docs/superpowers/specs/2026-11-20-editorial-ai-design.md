# Editorial AI for Madar

Use the existing copilot endpoint and newsroom editor for rewriting, proofreading, headlines and anchor leads. Offer story angles, interview questions and guest shortlist suggestions in the same editor and in episode preparation. Each request has a visible mode and provider. Planning takes an editable brief and title. The user reviews suggestions before copying, applying an edit, or opening an editable question draft.

The server accepts Gemini, OpenAI and OpenRouter credentials from environment variables and returns the available provider IDs and model names. The selected provider receives only the fields for the active mode. Text modes accept existing news creation and edit permissions, including the permission to edit one's own stories. Keep the per-account rate limit and the production card permission for brief drafts. API keys and raw provider errors stay on the server. An unavailable provider leaves the current editorial draft intact.

Guest candidates are starting points for editorial verification. Ask the model for relevant public names and the angle they could address, with a role or identity to verify where needed. Keep directory records, contact details and bookings out of the generation flow. Local proofreading and source-based templates remain available when provider keys are absent.

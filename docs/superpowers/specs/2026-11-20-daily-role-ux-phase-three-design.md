# Daily Role UX Phase Three

Stage 3 adds preparation and delivery work to the existing Arabic RTL episode, requests, and roster views. Existing permission checks and server rules govern every action.

## Producer preparation

Show a four-part checklist in the episode workspace for segment materials, the timed rundown, guest follow-up, and linked studio bookings. Use the existing readiness blockers and timing details for segment navigation. Guest work opens the episode guest controls. Show confirmed, tentative and sync-pending studio bookings by resource and time. Equipment, cancelled bookings and other episodes do not count as a studio booking. Open the existing booking form with a studio default when available and confirm the write there before reporting success. Checklist steps are derived from episode, request, media and booking records. They never set the episode state or change the readiness gate.

## Media request delivery

Add a media delivery tab to department requests. Show actionable montage, graphics and archive requests within the current handler scope, ordered by urgency, deadline, age and ID. Retain normal request filters and exact links to the linked news, episode or segment. Segment URLs keep focus after reload and move keyboard focus to the linked rundown row. Reuse acceptance, rejection, return and completion. Allow a handler to attach a result from the existing media picker while keeping completion without a result available under existing request rules. Confirm media persistence before writing its reference to the request. For montage, preserve already-ready or approved video status. A raw video needs the existing media change permission to be marked ready. Confirm the request write independently and keep queued or rejected results distinct from successful delivery.

## Crew shift acknowledgement

Use the existing handover list and receipts. Show a personal filter for published handovers which the crew member can acknowledge and has yet to acknowledge, along with an explicit confirmed receipt state. Read the exact handover on open, including notification links, and use neutral feedback if it is unavailable. Opening a handover never acknowledges it. The existing explicit receipt action is the only way to record receipt.

## Verification

Exercise studio matching, request ordering and department scope, and personal receipt state in focused tests. Verify the affected panels and acknowledged writes with private localhost browser fixtures at desktop and mobile sizes, including denied and pending states.

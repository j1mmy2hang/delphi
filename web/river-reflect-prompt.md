You refine a thought river. A conversation between a user and Delphi (an AI thinking companion) has been drawn as a river, move by move, as it happened. Each move was drawn knowing only what came before it, so the river is accurate but near-sighted: it mostly links each move to the one before, and it can't yet see which early remark turned out to matter, where two threads met, or where the user let a position go.

Now you see the whole conversation at once. Your job is hindsight: consolidate the river and draw out what it shows about the user's thinking, so that looking at it, they recognise the shape of their own mind.

## The river

Time flows right, one lane for each speaker. Each move has:
- `id`, `at` (the message number), `by` (`user` or `delphi`)
- `kind`: `question` (opens a thread or must be answered), `claim` (a belief, want, reading, explanation), `evidence` (a concrete fact, example or experience), `realization` (earlier separate threads come together into something new, or a stated position turns)
- `label`: the move in a few words, in the conversation's language (4–10 Chinese characters, 12 at most; or 2–5 English words, 6 at most)
- `rests`: the earlier moves it depends on, each `builds`, `answers` or `challenges`

## What you can change

You return edits; anything you don't mention stays as it is. Edit only where hindsight makes a real difference. A river that shifts every time it's looked at can't be trusted, so leave alone what is already right — but don't be timid where it isn't.

- `links` — **the most important edit.** New links from a later move back to an earlier one it really rests on, that the near-sighted drawing missed: the user returning to something they said long before, an answer that finally addresses an early question, a claim that quietly contradicts an earlier one (`challenges`). Prefer reaches across many messages; a link to the move just before adds nothing. `from` is the later move, `on` the earlier. A river drawn near-sightedly usually misses a lot of these — expect about one for every three messages — but each must be true of the conversation.
- `adds` — moves the drawing missed, above all the user's: a short reply can carry a lot ("im bad with friends" is a verdict on themselves, not small talk). Same shape as a move: `id` (continue the numbering you're told), `at`, `by`, `kind`, `label`, `rests` (only on moves from earlier messages). At most a few; only what the river is poorer without. Then link later moves to them where they rest on them.
- `kinds` — change a move's kind. Above all: promote to `realization` a move that, seen whole, is where threads came together or the user's position turned — and add `links` so it rests on the threads it joins. Never change a realization into anything else: the user may already have seen it light up, and taking it back feels like a loss. A realization can still be refined: sharpen its label (`relabels`) as the conversation shows what it really was, or `merges` it with another realization that turned out to be the same insight. A new realization must be real, and there are only a few: three at most for a short conversation, five for a long one, so each one means something; you're told the budget. If the river is at its budget and you see a deeper realization, make room by merging realizations that are one insight; never promote past the budget.
- `merges` — moves by the same speaker that say the same thing again without going further, or realizations (by either speaker) that are one insight reached twice: keep one, drop the rest. `keep` is the earliest of them; `drop` lists the others; `label` is the kept move's label, sharpened if saying it twice made it clearer. Links to dropped moves move to the kept one.
- `drops` — moves that carry nothing (never a realization): politeness, small talk, a question that went nowhere, a Delphi line that only restated the user. Links through a dropped move pass on to what it rested on.
- `relabels` — a sharper label where hindsight shows what a move was really about ("我想要被看见" rather than "我想去斯坦福"). Stay close to the user's own words for user moves. Don't relabel only to rephrase — except a realization, which should say as exactly as possible what came together.
- `revisions` — a user position the user later let go of or turned away from: `id` is the old move, `by` the later move that replaced it. The old move stays on the river, faded, as a record of the turn. Only where the user really moved; not where they added nuance.

Never invent what wasn't said, and never link a move to a later one.

## What the river says

- `title`: what the conversation is about, in its language, at most 14 Chinese characters or 8 English words. Keep the existing title unless the whole picture says otherwise.
- `insight`: one sentence, in the conversation's language and addressed to the user ("你" / "you"), saying what the river shows about their thinking that they might not have said themselves — a pattern, a tension, where they started and where they've arrived. At most 40 Chinese characters or 25 English words. Concrete, grounded in this conversation, warm, and not a summary of topics. If the conversation is too young to show anything yet, an empty string.

## Example edits

Conversation about applying to Stanford; at #3 the user said they want it for the prestige; at #17, after Delphi asked what they'd lose without it, they said what they really want is people who take ideas seriously.

- `links`: `{ "from": "m24", "on": "m3", "how": "challenges" }`
- `kinds`: `{ "id": "m24", "kind": "realization" }`
- `revisions`: `{ "id": "m3", "by": "m24" }`
- `insight`: "你一开始想要的是名校的光环，聊到最后想要的其实是一群认真对待想法的人。"

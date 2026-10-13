import type { LibraryStatus } from '../hooks/useConversationLibrary'
import { isSaveStatusOmitted } from './SaveStatus'

const PRIVACY = 'Your message is not stored or shared with anyone.'

/**
 * The fine print under the home screen's composer: what happens to a message,
 * and whether this conversation will be kept. Which version depends on what
 * this browser can do and whether a folder is linked.
 */
const notesFor = (status: LibraryStatus): string[] => {
  // Phones: saving isn't offered at all.
  if (isSaveStatusOmitted(status)) {
    return [
      PRIVACY,
      'To save your conversations locally, use Delphi on desktop.',
    ]
  }
  switch (status) {
    // With a folder linked the conversation *is* stored — on this computer —
    // so the note claims only what still holds.
    case 'ready':
      return ['Your message is not shared with anyone.']
    case 'none':
    case 'needs-permission':
      return [
        PRIVACY,
        'Create or link to a local folder if you wish to save your history locally.',
      ]
    // A desktop browser without folder access (Safari, Firefox): the folder
    // line would point at something it can't do, so only the privacy note.
    case 'unsupported':
      return [PRIVACY]
    default:
      return [] // still checking for a linked folder
  }
}

export const HomeNote = ({ status }: { status: LibraryStatus }) => {
  const notes = notesFor(status)
  if (notes.length === 0) return null
  return (
    <div
      // Its bottom margin, not the container's padding: padding on a flex item
      // with a zero basis is taken from the free space, which would lift the
      // hero and composer off their centre.
      // Desktop gets the width for each note to stay on one line, and sits a
      // little higher off the bottom edge (36px vs 28px). On phones
      // it makes way while the keyboard is up (index.css, .home-note).
      className="home-note mx-auto mb-[max(1.75rem,env(safe-area-inset-bottom))] flex max-w-sm flex-col gap-1 px-6 text-center text-xs leading-relaxed text-pretty text-muted-foreground pointer-fine:mb-12 pointer-fine:max-w-xl"
    >
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  )
}

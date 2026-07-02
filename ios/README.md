# Delphi for iOS

> **Think Deeper, Clearer, Better.**

A native iOS rebuild of [`delphi-web`](../delphi-web) — the same idea (an AI
thinking companion that materialises a single living message out of a prismatic
wave), rebuilt from the ground up for the platform rather than ported. The
input is a genuine iOS **Liquid Glass** bar, the wave is **Metal**, and the
choreography is **SwiftUI**.

The web app was the reference. This is what the idea wants to be on a phone.

---

## Requirements

- **Xcode 26 or newer** (iOS 26 SDK) — the input bar uses SwiftUI's real
  `.glassEffect` Liquid Glass, which ships in the iOS 26 SDK.
- An iOS 26 simulator or device.

> If you must target an older OS, lower `IPHONEOS_DEPLOYMENT_TARGET` in the
> project: `liquidGlassField(cornerRadius:)` already falls back to a translucent
> material below iOS 26. (It still needs the iOS 26 *SDK* to compile.)

## Run it

```bash
open Delphi.xcodeproj
```

Press **⌘R**. That's it — no dependencies, no package resolution. The project
uses an Xcode file-system–synchronized group, so every file under `Delphi/` is
part of the target automatically.

In a **Debug** build with no backend reachable, the app streams a canned reply
so the wave and choreography can be experienced offline. Point it at a real
backend (below) for live conversations.

## Backend

Secrets stay server-side, exactly like the web app: the OpenRouter API key and
the system prompt live in the existing Netlify function, and the app only ever
receives the streamed reply. Set your deployment once:

```swift
// Delphi/Conversation/ChatService.swift
enum Endpoint {
    static let base = "https://delphi-web.netlify.app"   // ← your site
    static let chat = URL(string: "\(base)/.netlify/functions/chat")!
}
```

The app POSTs `{ "messages": [...] }` and reads the same SSE stream the web app
does — so the `delphi-web` Netlify deploy backs both clients unchanged.

---

## How the web app maps to native

The brief was to keep the *experience* and rebuild the *how*. Each web mechanism
was replaced with the platform-native equivalent that achieves the same feel:

| Experience | Web (reference) | iOS (this app) |
|---|---|---|
| The thinking wave | WebGL ray-march on a `<canvas>` | **Metal** shader in an `MTKView` (`PrismaticBurst.metal`) |
| Liquid-glass input | CSS `backdrop-filter` + hand-built SVG displacement map | **`.glassEffect`** — the real system Liquid Glass |
| Forming / dissolving text | SVG `feTurbulence` displacement | SwiftUI blur + scale + drift transitions |
| Words rising from the input | Framer Motion overlay | `AscendingMessageView` with a spring-settle animation |
| Conversation choreography | `useConversationStage` + `useChatStream` hooks | `@Observable ConversationModel` with async `Task`s |
| Streaming | `fetch` + manual SSE parse | `URLSession.bytes` + `AsyncLineSequence` |
| Keyboard handling | Manual `visualViewport` lifting | Native keyboard avoidance (the glass bar rises; the stage stays) |
| Serif wordmark | Bundled Google web font | Apple's **New York** system serif |

Same arc, same timings (`rise 1.25s · dissolve 1.05s · form 1.25s · min-think
0.9s`), same per-phase wave energy (`idle → rising → thinking → dissolving →
forming → settled`). The numbers were carried over verbatim from the web
`constants.ts`.

## Project layout

```
Delphi/
├─ DelphiApp.swift            App entry
├─ ContentView.swift          Composes burst · scrim · stage · ascent · dock
├─ Theme/
│  └─ Theme.swift             Colours, the New York serif, easing curves, halo
├─ Conversation/
│  ├─ Message.swift           Wire model ({ role, content })
│  ├─ ChatService.swift       SSE streaming + offline simulation
│  ├─ ConversationModel.swift The choreography state machine
│  └─ Markdown.swift          Tag stripping + paragraph/inline formatting
├─ Views/
│  ├─ PrismaticBurstView.swift   MTKView wrapper, eased intensity, 60fps cap
│  ├─ MessageStageView.swift     The single living message + materialise/dissolve
│  ├─ AscendingMessageView.swift The send-to-centre hand-off
│  └─ InputDockView.swift        The Liquid Glass input bar
├─ Shaders/
│  └─ PrismaticBurst.metal    GLSL ray-march, ported to MSL (bg + screen blend baked in)
└─ Assets.xcassets           App icon (a luminous serif “D”) + accent colour
```

## Design notes

- **The wave is the centrepiece, so it gets the native equivalent of WebGL.**
  Metal renders at ~⅔ resolution with a 60fps cap — the burst is soft, so the
  upscale is invisible while the GPU does a fraction of the work. The deep
  background gradient and the screen blend are baked into the shader for one
  correct opaque pass. It pauses when the app isn't active.
- **Replies reveal whole, not token-by-token** — matching the web app, the
  question rests at centre while the oracle works, then the reply forms out of
  the cloud once it's ready.
- **The serif is New York, not a web font.** "Use Apple-native elements
  wherever possible": New York is the system serif — elegant, nothing to bundle.
- **Forced dark.** The prismatic spectrum only sings on a cinematic dark stage,
  so the app runs in dark mode regardless of system setting.

---

_Built with Command Line Tools available but full Xcode not installed on the
authoring machine — so the Foundation logic and the `@Observable` model were
typechecked against the macOS SDK, but the final compile/run happens in your
Xcode. Everything is standard iOS 26 SDK; there are no external dependencies._

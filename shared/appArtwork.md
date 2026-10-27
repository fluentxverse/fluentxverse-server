# App Artwork

Student and tutor apps share the names in `appArtwork.ts`. Files live in each
app's `public/assets/img/home-icons/` directory. Existing artwork is retained;
the fourteen new files are additive, transparent 384px WebP assets.

Use the same image for the same meaning across apps. Do not use conversation
art as a generic placeholder. Small action controls should use Lucide icons.
Keep decorative heading images `alt=""` with stable width/height; the adjacent
label is the accessible name. Never replace user photos or lesson content.

## Generated Assets And Prompt Set

Generated with the built-in ImageGen tool on October 17, 2026, one image per
subject. Shared prompt direction: one isolated polished 3D educational UI icon;
cobalt blue, mint, cream and restrained gold; friendly ceramic/metal surfaces,
soft bevels, three-quarter front view, strong silhouette readable at 32px;
centered square canvas with equal padding; genuinely transparent background;
no scene, platform, surrounding UI, unnecessary objects, logos or text.

| Name | Subject Prompt | Use |
| --- | --- | --- |
| notifications | Cobalt bell, gold clapper, mint notification dot | Notifications, not schedules |
| inbox | Open blue envelope, cream letter, mint corner tab | Inbox and message history |
| profile | Blue identity card, cream head-and-shoulders silhouette, mint bars | Profiles and about-me content |
| video | Blue camcorder, cream play triangle, mint lens hood, red recording light | Introduction video and recording notices |
| reviews | Gold star on blue feedback tile with cream feedback lines | Reviews and feedback |
| support | Blue/cream life preserver with mint rope | Help and support |
| issue | Amber warning triangle with cobalt exclamation mark | Errors and lesson issues |
| business | Mint professional briefcase, blue handle, gold clasp | Business English |
| vocabulary | Blue dictionary, cream pages, mint bookmark, gold ABC | Vocabulary and new words |
| music | Connected eighth notes with mint heads and blue stems | Songs and sing-along content |
| story | Open cream storybook, blue cover, mint bookmark, gold star | Story time and reading |
| certificate | Cream certificate scroll, blue edges, gold seal, mint ribbons | Tutor certification and expertise |
| privacy | Mint shield, blue rim, cream padlock with gold shackle | Privacy, terms and security |
| classroom | Blue laptop, mint screen, cream teacher silhouette, gold call controls | Online lessons and teaching |

The ABC letters, play triangle, exclamation mark, and simple abstract letter
lines are intentional semantic details. Full-resolution generation originals
remain in Codex's generated-images directory. WebP conversion only scales and
compresses them; it preserves alpha.

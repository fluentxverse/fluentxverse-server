import manifest from './artwork-manifest.json';

export const chapter3ApprovedArtwork = manifest.assets;
export const chapter3ArtworkSlots = [1, 2, 3, 4, 6, 7, 8, 9];

/** Change only the approved media slots in an existing lesson. No content rebuild. */
export function chapter3ArtworkUpdates(original: any): Record<string, string> {
  const n = typeof original.lessonNumber === 'number' ? original.lessonNumber : original.lessonNumber?.low;
  const level = typeof original.level === 'number' ? original.level : original.level?.low;
  const chapter = typeof original.chapter === 'number' ? original.chapter : original.chapter?.low;
  const assets = chapter3ApprovedArtwork.filter(a => a.lesson === n);
  if (original.course !== 'conversational-skills' || level !== 3 || chapter !== 3 || !chapter3ArtworkSlots.includes(n) || assets.length !== 9) throw Error('Unexpected lesson slot');
  if (original.lessonName !== assets[0]!.title) throw Error('Lesson title differs from reviewed artwork');
  const parse = (key: string) => {
    if (!original[key]) throw Error(`Missing ${key}`);
    return typeof original[key] === 'string' ? JSON.parse(original[key]) : structuredClone(original[key]);
  };
  const introduction = parse('introductionData'), apply = parse('applyData'), mission = parse('missionData'), learn = parse('learnData');
  const url = (key: string) => {
    const selected = assets.filter(a => a.key === key);
    if (selected.length !== 1) throw Error('Missing or duplicate artwork');
    return selected[0]!.url;
  };
  const oldMissionImage = mission.image;
  introduction.introImage = url('introduce'); apply.situationImage = url('apply'); mission.image = url('challenge1');
  if (mission.missionType === 'reading' || original.skill === 'reading') {
    if (!Array.isArray(mission.readingPassage?.blocks)) throw Error('Reading mission passage missing');
    for (const block of mission.readingPassage.blocks) {
      if (block.type === 'images' && Array.isArray(block.images) && oldMissionImage) {
        block.images = block.images.map((image: string) => image === oldMissionImage ? mission.image : image);
      }
    }
    if (!mission.readingPassage.blocks.some((b: any) => b.type === 'images' && b.images?.includes(mission.image))) {
      mission.readingPassage.blocks.push({ type: 'images', images: [mission.image] });
    }
  }
  const steps = learn.steps?.filter((s: any) => s.stepType === 'vocabulary');
  if (steps?.length !== 1 || steps[0].vocabularyItems?.length !== 6) throw Error('Expected one six-item vocabulary step');
  for (const asset of assets.filter(a => a.kind === 'photo')) {
    const matches = steps[0].vocabularyItems.filter((v: any) => v.highlightedWord === asset.label && v.englishText === asset.sentence);
    if (matches.length !== 1) throw Error(`Vocabulary changed since review: ${n} ${asset.label}`);
    matches[0].image = asset.url;
  }
  return {
    introductionData: JSON.stringify(introduction), applyData: JSON.stringify(apply),
    missionData: JSON.stringify(mission), learnData: JSON.stringify(learn), backgroundImage: url('introduce'),
  };
}

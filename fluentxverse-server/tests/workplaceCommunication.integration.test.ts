import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { lessonMaterialService } from '../src/services/lessonMaterial.service';
import { createWorkplaceTemplate, WORKPLACE_COMMUNICATION_COURSE } from '../../shared/workplaceCommunication';

const uri = process.env.WORKPLACE_TEST_MEMGRAPH_URI;
const suite = uri ? describe : describe.skip;
const createdBy = `workplace-fixture-${crypto.randomUUID()}`;

suite('Workplace Communication Memgraph persistence', () => {
  beforeAll(async () => { await initDriver(uri!, '', '', 1); });
  afterAll(async () => {
    const session = getDriver().session();
    try { await session.run('MATCH (lesson:LessonMaterial {createdBy: $createdBy}) DETACH DELETE lesson', { createdBy }); }
    finally { await session.close(); await closeDriver(); }
  });

  test('creates and updates its own document without changing Business English', async () => {
    const base = { level: 3, chapter: 1, chapterName: 'Test', lessonNumber: 1, skill: 'speaking' as const, lessonName: 'New colleagues', goalTextEn: 'Introduce your role.', goalTextJp: '', createdBy };
    const business = await lessonMaterialService.create({ ...base, course: 'business-english', lessonNumber: 3 });
    const original = await lessonMaterialService.getById(business.id);
    const prepare = createWorkplaceTemplate('prepare');
    const brief = prepare.sections[0]; if (!brief) throw Error('Expected the workplace brief section');
    brief.content = 'Meet your new colleague.';
    const lesson = await lessonMaterialService.create({ ...base, course: WORKPLACE_COMMUNICATION_COURSE, workplaceData: prepare });
    expect(lesson.workplaceData).toEqual(prepare);
    expect(lesson.status).toBe('draft');
    const changed = structuredClone(prepare);
    const words = changed.sections[1]; if (!words) throw Error('Expected the workplace words section');
    words.content = 'department\ncolleague';
    words.tutorNotes = 'Model each word, then ask for repetition.';
    await lessonMaterialService.updateHeader(lesson.id, { workplaceData: changed });
    expect((await lessonMaterialService.getById(lesson.id))?.workplaceData).toEqual(changed);
    expect((await lessonMaterialService.listByCourse(WORKPLACE_COMMUNICATION_COURSE)).find(item => item.id === lesson.id)?.workplaceData).toEqual(changed);
    await expect(lessonMaterialService.updateHeader(business.id, { workplaceData: changed })).rejects.toThrow('own course');
    expect(await lessonMaterialService.getById(business.id)).toEqual(original);
    const perform = await lessonMaterialService.create({ ...base, course: WORKPLACE_COMMUNICATION_COURSE, lessonNumber: 2, workplaceData: createWorkplaceTemplate('perform') });
    expect((await lessonMaterialService.getById(perform.id))?.workplaceData?.mode).toBe('perform');
    await expect(lessonMaterialService.create({ ...base, course: WORKPLACE_COMMUNICATION_COURSE, workplaceData: prepare })).rejects.toThrow('already exists');
  });
});

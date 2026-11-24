import { publishedRoadmapLessons } from './roadmapLessons/publication';

type LessonTitles = readonly [string, string, string, string, string];
type Unit = readonly [name: string, lessons: LessonTitles];

export const FLUENT_KIDS_NAME = 'Fluent Kids';
export const FLUENT_KIDS_PATH = '/materials/fluent-kids';
export const FLUENT_KIDS_EDITOR_PATH = '/fluent-kids-editor';
export const PARK_LESSON_ID = 'fluent-kids-l1-u1-l1';
export const COLOR_HUNT_LESSON_ID = 'fluent-kids-l1-u1-l2';
export const WHERES_THE_BALL_LESSON_ID = 'fluent-kids-l1-u1-l3';
export const PARK_DETECTIVES_LESSON_ID = 'fluent-kids-l1-u1-l4';
export const PARK_GUIDE_LESSON_ID = 'fluent-kids-l1-u1-l5';
export const SCHOOL_BAG_LESSON_ID = 'fluent-kids-l1-u2-l1';
export const HOW_MANY_PENCILS_LESSON_ID = 'fluent-kids-l1-u2-l2';
export const CAN_I_BORROW_IT_LESSON_ID = 'fluent-kids-l1-u2-l3';
export const PACK_FOR_CLASS_LESSON_ID = 'fluent-kids-l1-u2-l4';
export const READY_FOR_SCHOOL_LESSON_ID = 'fluent-kids-l1-u2-l5';
export const MEET_THE_ANIMALS_LESSON_ID = 'fluent-kids-l1-u3-l1';
export const BIG_SMALL_AND_FAST_LESSON_ID = 'fluent-kids-l1-u3-l2';
export const CAN_IT_SWIM_LESSON_ID = 'fluent-kids-l1-u3-l3';
export const GUESS_MY_ANIMAL_LESSON_ID = 'fluent-kids-l1-u3-l4';
export const ANIMAL_KEEPER_LESSON_ID = 'fluent-kids-l1-u3-l5';
export const LUNCHBOX_LESSON_ID = 'fluent-kids-l1-u4-l1';
export const I_LIKE_APPLES_LESSON_ID = 'fluent-kids-l1-u4-l2';
export const CAN_I_HAVE_SOME_WATER_LESSON_ID = 'fluent-kids-l1-u4-l3';
export const A_SNACK_FOR_MY_FRIEND_LESSON_ID = 'fluent-kids-l1-u4-l4';
export const SNACK_STAND_LESSON_ID = 'fluent-kids-l1-u4-l5';
export const WHATS_THE_WEATHER_LIKE_LESSON_ID = 'fluent-kids-l1-u5-l1';
export const WHAT_ARE_YOU_WEARING_LESSON_ID = 'fluent-kids-l1-u5-l2';
export const WHAT_SHOULD_I_WEAR_LESSON_ID = 'fluent-kids-l1-u5-l3';
export const PACK_FOR_A_RAINY_DAY_LESSON_ID = 'fluent-kids-l1-u5-l4';
export const WEATHER_HELPER_LESSON_ID = 'fluent-kids-l1-u5-l5';
export const WHAT_DO_YOU_LIKE_TO_PLAY_LESSON_ID = 'fluent-kids-l1-u6-l1';
export const CAN_YOU_PLAY_WITH_ME_LESSON_ID = 'fluent-kids-l1-u6-l2';
export const MY_TURN_YOUR_TURN_LESSON_ID = 'fluent-kids-l1-u6-l3';
export const PICK_A_GAME_TOGETHER_LESSON_ID = 'fluent-kids-l1-u6-l4';
export const PLAYGROUND_PARTNERS_LESSON_ID = 'fluent-kids-l1-u6-l5';
export const MEET_MY_FAMILY_LESSON_ID = 'fluent-kids-l1-u7-l1';
export const WHOS_IN_THE_PICTURE_LESSON_ID = 'fluent-kids-l1-u7-l2';
export const HOW_ARE_THEY_FEELING_LESSON_ID = 'fluent-kids-l1-u7-l3';
export const WHAT_DO_THEY_LIKE_LESSON_ID = 'fluent-kids-l1-u7-l4';
export const MEET_THE_CHARACTERS_LESSON_ID = 'fluent-kids-l1-u7-l5';
export const WELCOME_TO_MY_HOME_LESSON_ID = 'fluent-kids-l1-u8-l1';
export const WHATS_IN_THIS_ROOM_LESSON_ID = 'fluent-kids-l1-u8-l2';
export const WHERE_ARE_MY_SHOES_LESSON_ID = 'fluent-kids-l1-u8-l3';
export const WHAT_ARE_THEY_DOING_LESSON_ID = 'fluent-kids-l1-u8-l4';
export const THE_HOME_TOUR_LESSON_ID = 'fluent-kids-l1-u8-l5';
export const PLACES_IN_MY_TOWN_LESSON_ID = 'fluent-kids-l2-u1-l1';
export const GO_STRAIGHT_TURN_LEFT_LESSON_ID = 'fluent-kids-l2-u1-l2';
export const FOLLOW_THE_MAP_LESSON_ID = 'fluent-kids-l2-u1-l3';
export const ASK_A_LOCAL_LESSON_ID = 'fluent-kids-l2-u1-l4';
export const HELP_A_VISITOR_LESSON_ID = 'fluent-kids-l2-u1-l5';
export const WHAT_TIME_DO_YOU_GET_UP_LESSON_ID = 'fluent-kids-l2-u2-l1';
export const MY_SCHOOL_DAY_ROUTINE_LESSON_ID = 'fluent-kids-l2-u2-l2';
export const HOW_OFTEN_DO_YOU_PLAY_LESSON_ID = 'fluent-kids-l2-u2-l3';
export const INTERVIEW_A_FRIEND_LESSON_ID = 'fluent-kids-l2-u2-l4';
export const OUR_WEEK_IN_PICTURES_LESSON_ID = 'fluent-kids-l2-u2-l5';
export const WHERE_DO_ANIMALS_LIVE_LESSON_ID = 'fluent-kids-l2-u3-l1';
export const WHAT_DO_THEY_EAT_LESSON_ID = 'fluent-kids-l2-u3-l2';
export const READ_AN_ANIMAL_FACT_CARD_LESSON_ID = 'fluent-kids-l2-u3-l3';
export const COMPARE_TWO_ANIMALS_LESSON_ID = 'fluent-kids-l2-u3-l4';
export const HABITAT_MATCH_LESSON_ID = 'fluent-kids-l2-u3-l5';
export const READ_THE_MENU_LESSON_ID = 'fluent-kids-l2-u4-l1';
export const ID_LIKE_A_SANDWICH_LESSON_ID = 'fluent-kids-l2-u4-l2';
export const WHAT_WOULD_YOU_LIKE_TO_DRINK_LESSON_ID = 'fluent-kids-l2-u4-l3';
export const SORRY_WERE_OUT_OF_THAT_LESSON_ID = 'fluent-kids-l2-u4-l4';
export const CAFE_ROLEPLAY_LESSON_ID = 'fluent-kids-l2-u4-l5';
export const WHAT_ARE_YOU_DOING_ON_SATURDAY_LESSON_ID = 'fluent-kids-l2-u5-l1';
export const WOULD_YOU_LIKE_TO_COME_LESSON_ID = 'fluent-kids-l2-u5-l2';
export const WHERE_AND_WHEN_LESSON_ID = 'fluent-kids-l2-u5-l3';
export const MAKE_A_PLAN_THAT_WORKS_LESSON_ID = 'fluent-kids-l2-u5-l4';
export const SEE_YOU_ON_SATURDAY_LESSON_ID = 'fluent-kids-l2-u5-l5';
export const WHAT_DOES_IT_LOOK_LIKE_LESSON_ID = 'fluent-kids-l2-u6-l1';
export const WHERE_DID_YOU_LAST_SEE_IT_LESSON_ID = 'fluent-kids-l2-u6-l2';
export const READ_A_LOST_ITEM_NOTICE_LESSON_ID = 'fluent-kids-l2-u6-l3';

const authoredLessons = [
  { id: PARK_LESSON_ID, goalTextEn: 'I can name things I see and ask, “What do you see?”' },
  { id: COLOR_HUNT_LESSON_ID, goalTextEn: 'I can ask what color something is and describe it in English.' },
  { id: WHERES_THE_BALL_LESSON_ID, goalTextEn: 'I can ask where something is and say where it is.' },
  { id: PARK_DETECTIVES_LESSON_ID, goalTextEn: 'I can ask for two clues and use them to find something.' },
  { id: PARK_GUIDE_LESSON_ID, goalTextEn: 'I can give a short park tour and ask and answer questions about what I see.' },
  { id: SCHOOL_BAG_LESSON_ID, goalTextEn: 'I can ask what’s in someone’s school bag and say what I have.' },
  { id: HOW_MANY_PENCILS_LESSON_ID, goalTextEn: 'I can ask how many school supplies someone has and answer with a number.' },
  { id: CAN_I_BORROW_IT_LESSON_ID, goalTextEn: 'I can ask to borrow a school supply and respond politely.' },
  { id: PACK_FOR_CLASS_LESSON_ID, goalTextEn: 'I can check a class list and say what I have and what I still need.' },
  { id: READY_FOR_SCHOOL_LESSON_ID, goalTextEn: 'I can get my school bag ready by checking a list, counting supplies, and asking for what I need.' },
  { id: MEET_THE_ANIMALS_LESSON_ID, goalTextEn: 'I can ask “What is it?”, name an animal, and describe one thing I notice.' },
  { id: BIG_SMALL_AND_FAST_LESSON_ID, goalTextEn: 'I can ask and answer questions about an animal’s size and speed.' },
  { id: CAN_IT_SWIM_LESSON_ID, goalTextEn: 'I can ask what an animal can do and answer with “Yes, it can” or “No, it can’t.”' },
  { id: GUESS_MY_ANIMAL_LESSON_ID, goalTextEn: 'I can give two clues, ask for another clue, and guess a mystery animal.' },
  { id: ANIMAL_KEEPER_LESSON_ID, goalTextEn: 'I can describe an animal, ask and answer what it can do, and use two clues to guess.' },
  { id: LUNCHBOX_LESSON_ID, goalTextEn: 'I can name lunch items and ask and answer what’s in a lunchbox.' },
  { id: I_LIKE_APPLES_LESSON_ID, goalTextEn: 'I can say which foods I like or don’t like and ask someone what they like.' },
  { id: CAN_I_HAVE_SOME_WATER_LESSON_ID, goalTextEn: 'I can ask for a drink politely, offer it to someone, and say thank you.' },
  { id: A_SNACK_FOR_MY_FRIEND_LESSON_ID, goalTextEn: 'I can ask what a friend likes, offer a snack, and accept or decline politely.' },
  { id: SNACK_STAND_LESSON_ID, goalTextEn: 'I can ask for a snack and a drink, offer a choice, and finish the conversation politely.' },
  { id: WHATS_THE_WEATHER_LIKE_LESSON_ID, goalTextEn: 'I can ask about the weather, describe it, and point out a clue I can see.' },
  { id: WHAT_ARE_YOU_WEARING_LESSON_ID, goalTextEn: 'I can ask what someone is wearing and describe clothes by name and color.' },
  { id: WHAT_SHOULD_I_WEAR_LESSON_ID, goalTextEn: 'I can ask what to wear, give advice for the weather, and explain why.' },
  { id: PACK_FOR_A_RAINY_DAY_LESSON_ID, goalTextEn: 'I can check a rainy-day list and say what I have, what I still need, and what to wear.' },
  { id: WEATHER_HELPER_LESSON_ID, goalTextEn: 'I can report the weather and help a friend decide what to wear and pack.' },
  { id: WHAT_DO_YOU_LIKE_TO_PLAY_LESSON_ID, goalTextEn: 'I can ask what someone likes to play and say which games we both like.' },
  { id: CAN_YOU_PLAY_WITH_ME_LESSON_ID, goalTextEn: 'I can invite a friend to play and answer an invitation politely.' },
  { id: MY_TURN_YOUR_TURN_LESSON_ID, goalTextEn: 'I can ask for a turn, wait, and tell a friend when it’s their turn.' },
  { id: PICK_A_GAME_TOGETHER_LESSON_ID, goalTextEn: 'I can suggest a game, offer another idea, and agree on what to play.' },
  { id: PLAYGROUND_PARTNERS_LESSON_ID, goalTextEn: 'I can ask what a friend likes, invite them to play, choose a game together, and take turns.' },
  { id: MEET_MY_FAMILY_LESSON_ID, goalTextEn: 'I can name family members and introduce them with “This is my …”.' },
  { id: WHOS_IN_THE_PICTURE_LESSON_ID, goalTextEn: 'I can point to someone in a picture, ask who they are, and answer with their name or role.' },
  { id: HOW_ARE_THEY_FEELING_LESSON_ID, goalTextEn: 'I can ask how someone is feeling and answer with a feeling word.' },
  { id: WHAT_DO_THEY_LIKE_LESSON_ID, goalTextEn: 'I can ask what someone likes to do and tell a friend about their favorite activity.' },
  { id: MEET_THE_CHARACTERS_LESSON_ID, goalTextEn: 'I can introduce a character, ask how they feel, and tell someone what they like to do.' },
  { id: WELCOME_TO_MY_HOME_LESSON_ID, goalTextEn: 'I can name rooms in a home and show a visitor around.' },
  { id: WHATS_IN_THIS_ROOM_LESSON_ID, goalTextEn: 'I can ask what’s in a room and say what I see with “There’s” or “There are.”' },
  { id: WHERE_ARE_MY_SHOES_LESSON_ID, goalTextEn: 'I can ask where things are and give a clue to help someone find them.' },
  { id: WHAT_ARE_THEY_DOING_LESSON_ID, goalTextEn: 'I can ask what someone is doing and describe what one or more people are doing right now.' },
  { id: THE_HOME_TOUR_LESSON_ID, goalTextEn: 'I can give a home tour, describe rooms, help a visitor find something, and say what people are doing.' },
  { id: PLACES_IN_MY_TOWN_LESSON_ID, goalTextEn: 'I can name places in town and tell a visitor what they can do there.' },
  { id: GO_STRAIGHT_TURN_LEFT_LESSON_ID, goalTextEn: 'I can ask for directions and say, “Go straight,” “Turn left,” or “Turn right.”' },
  { id: FOLLOW_THE_MAP_LESSON_ID, goalTextEn: 'I can follow directions on a map and say where I end up.' },
  { id: ASK_A_LOCAL_LESSON_ID, goalTextEn: 'I can ask for directions politely and check what I heard.' },
  { id: HELP_A_VISITOR_LESSON_ID, goalTextEn: 'I can suggest a place, give directions on a map, and check that my visitor knows the way.' },
  { id: WHAT_TIME_DO_YOU_GET_UP_LESSON_ID, goalTextEn: 'I can ask what time someone gets up and say what time I get up.' },
  { id: MY_SCHOOL_DAY_ROUTINE_LESSON_ID, goalTextEn: 'I can describe my school-day routine in order and say when I do things.' },
  { id: HOW_OFTEN_DO_YOU_PLAY_LESSON_ID, goalTextEn: 'I can read a weekly chart and ask and answer questions about how often we do things.' },
  { id: INTERVIEW_A_FRIEND_LESSON_ID, goalTextEn: 'I can interview a partner about their week and share what I learned.' },
  { id: OUR_WEEK_IN_PICTURES_LESSON_ID, goalTextEn: 'I can use pictures to describe my routine and share something I learned about a partner’s week.' },
  { id: WHERE_DO_ANIMALS_LIVE_LESSON_ID, goalTextEn: 'I can match an animal to a habitat and say why it can live there.' },
  { id: WHAT_DO_THEY_EAT_LESSON_ID, goalTextEn: 'I can ask what an animal eats and say where it finds food.' },
  { id: READ_AN_ANIMAL_FACT_CARD_LESSON_ID, goalTextEn: 'I can read an animal fact card, find key details, and tell someone what I learned.' },
  { id: COMPARE_TWO_ANIMALS_LESSON_ID, goalTextEn: 'I can use facts to say how two animals are alike and different.' },
  { id: HABITAT_MATCH_LESSON_ID, goalTextEn: 'I can match animals to their habitats, explain my choices, and compare two animals.' },
  { id: READ_THE_MENU_LESSON_ID, goalTextEn: 'I can read a café menu, ask how much something costs, and choose a snack and a drink.' },
  { id: ID_LIKE_A_SANDWICH_LESSON_ID, goalTextEn: 'I can order a snack politely and check that the server heard me correctly.' },
  { id: WHAT_WOULD_YOU_LIKE_TO_DRINK_LESSON_ID, goalTextEn: 'I can offer a drink, ask about the choices, and answer politely.' },
  { id: SORRY_WERE_OUT_OF_THAT_LESSON_ID, goalTextEn: 'I can explain that an item is sold out, offer a replacement, and respond politely.' },
  { id: CAFE_ROLEPLAY_LESSON_ID, goalTextEn: 'I can use a menu, order politely, and work out a different choice when an item is sold out.' },
  { id: WHAT_ARE_YOU_DOING_ON_SATURDAY_LESSON_ID, goalTextEn: 'I can ask about Saturday plans and say what I’m doing and when.' },
  { id: WOULD_YOU_LIKE_TO_COME_LESSON_ID, goalTextEn: 'I can invite a friend to a weekend plan and accept or decline politely.' },
  { id: WHERE_AND_WHEN_LESSON_ID, goalTextEn: 'I can ask where and when to meet and repeat both details to check the plan.' },
  { id: MAKE_A_PLAN_THAT_WORKS_LESSON_ID, goalTextEn: 'I can check two schedules, suggest a time that works for both of us, and confirm the plan.' },
  { id: SEE_YOU_ON_SATURDAY_LESSON_ID, goalTextEn: 'I can invite a friend, find a time that works for both of us, and confirm where and when to meet.' },
  { id: WHAT_DOES_IT_LOOK_LIKE_LESSON_ID, goalTextEn: 'I can ask what a lost item looks like and use its color, size, and features to describe it.' },
  { id: WHERE_DID_YOU_LAST_SEE_IT_LESSON_ID, goalTextEn: 'I can ask where someone last saw an item and tell the place and time in order.' },
  { id: READ_A_LOST_ITEM_NOTICE_LESSON_ID, goalTextEn: 'I can read a lost-item notice, find the important details, and say what to do if I find the item.' },
] as const;

export type AuthoredFluentKidsLessonId = typeof authoredLessons[number]['id'];
const availableLessons = [...authoredLessons, ...publishedRoadmapLessons];
export type FluentKidsLessonId = typeof availableLessons[number]['id'];

const levels: readonly { name: string; goal: string; units: readonly Unit[] }[] = [
  {
    name: 'First Conversations',
    goal: 'Name and describe familiar things and take turns in short conversations.',
    units: [
      ['At the Park', ['A Day in the Park', 'The Color Hunt', 'Where’s the Ball?', 'Park Detectives', 'Be My Park Guide']],
      ['My School Bag', ['What’s in My Bag?', 'How Many Pencils?', 'Can I Borrow It?', 'Pack for Class', 'Ready for School']],
      ['Animal Friends', ['Meet the Animals', 'Big, Small, and Fast', 'Can It Swim?', 'Guess My Animal', 'Animal Keeper']],
      ['Snack Time', ['What’s in the Lunchbox?', 'I Like Apples', 'Can I Have Some Water?', 'A Snack for My Friend', 'Snack Stand']],
      ['Outside Today', ['What’s the Weather Like?', 'What Are You Wearing?', 'What Should I Wear?', 'Pack for a Rainy Day', 'Weather Helper']],
      ['Let’s Play', ['What Do You Like to Play?', 'Can You Play With Me?', 'My Turn, Your Turn', 'Pick a Game Together', 'Playground Partners']],
      ['People I Know', ['Meet My Family', 'Who’s in the Picture?', 'How Are They Feeling?', 'What Do They Like?', 'Meet the Characters']],
      ['At Home', ['Welcome to My Home', 'What’s in This Room?', 'Where Are My Shoes?', 'What Are They Doing?', 'The Home Tour']],
    ],
  },
  {
    name: 'Everyday English',
    goal: 'Ask for information, talk about routines and plans, and solve everyday problems.',
    units: [
      ['Around Town', ['Places in My Town', 'Go Straight, Turn Left', 'Follow the Map', 'Ask a Local', 'Help a Visitor']],
      ['My Week', ['What Time Do You Get Up?', 'My School-Day Routine', 'How Often Do You Play?', 'Interview a Friend', 'Our Week in Pictures']],
      ['Animal Habitats', ['Where Do Animals Live?', 'What Do They Eat?', 'Read an Animal Fact Card', 'Compare Two Animals', 'Habitat Match']],
      ['At the Café', ['Read the Menu', 'I’d Like a Sandwich', 'What Would You Like to Drink?', 'Sorry, We’re Out of That', 'Café Roleplay']],
      ['Weekend Plans', ['What Are You Doing on Saturday?', 'Would You Like to Come?', 'Where and When?', 'Make a Plan That Works', 'See You on Saturday']],
      ['Lost and Found', ['What Does It Look Like?', 'Where Did You Last See It?', 'Read a Lost-Item Notice', 'Ask the Office for Help', 'Find the Right Bag']],
      ['At the Market', ['Make a Shopping List', 'How Much Is It?', 'How Many Do We Need?', 'Choose Within a Budget', 'Shop for a Picnic']],
      ['On the Move', ['How Do You Get There?', 'Read a Simple Timetable', 'Which Bus Should We Take?', 'We Missed the Bus', 'Get There on Time']],
    ],
  },
  {
    name: 'Stories & Projects',
    goal: 'Retell events, give reasons, and make decisions with a partner.',
    units: [
      ['Plan a Day Out', ['Read Three Place Cards', 'Compare Two Places', 'Give a Reason', 'Agree on the Schedule', 'Pitch Our Day Out']],
      ['School Club Fair', ['Explore Club Posters', 'Ask About Interests', 'Interview a Club Member', 'Recommend a Club', 'Find the Right Club']],
      ['Wildlife Report', ['Choose an Animal', 'Find the Main Idea', 'Pick the Best Facts', 'Rehearse and Take Questions', 'Wildlife Reporter']],
      ['Design a Café', ['Explore Two Menus', 'Choose Who the Café Is For', 'Write a Mini Menu', 'Solve a Customer Problem', 'Present Your Café']],
      ['A Plan That Changed', ['What Was the Plan?', 'What Happened First?', 'Explain Why It Changed', 'Suggest a Backup Plan', 'Tell the Story, Fix the Plan']],
      ['The Missing Bag', ['Read the Case File', 'Ask Two Witnesses', 'Put the Clues in Order', 'Test Your Explanation', 'Solve the Mystery']],
      ['Build a Better Park', ['Read the Park Map', 'Listen to What Visitors Need', 'Compare Improvements', 'Choose Two Changes', 'Pitch a Better Park']],
      ['The Kids’ News Show', ['Choose a Local Story', 'Prepare Interview Questions', 'Interview a Guest', 'Write and Rehearse the Rundown', 'Present the News']],
    ],
  },
];

export const fluentKidsLevels = levels.map((level, levelIndex) => ({
  name: level.name,
  goal: level.goal,
  number: levelIndex + 1,
  units: level.units.map(([name, lessons], unitIndex) => ({
    name,
    number: unitIndex + 1,
    lessons: lessons.map((title, lessonIndex) => {
      const id = `fluent-kids-l${levelIndex + 1}-u${unitIndex + 1}-l${lessonIndex + 1}`;
      return { id, title, number: lessonIndex + 1, checkpoint: lessonIndex === 4, available: availableLessons.some(lesson => lesson.id === id) };
    }),
  })),
}));

export const fluentKidsLessonCount = fluentKidsLevels.reduce(
  (count, level) => count + level.units.reduce((total, unit) => total + unit.lessons.length, 0),
  0,
);

const publishedLessons = fluentKidsLevels.flatMap(level => level.units.flatMap(unit => unit.lessons.flatMap(lesson => {
  const available = availableLessons.find(entry => entry.id === lesson.id);
  return available ? [{
    ...available,
    title: lesson.title,
    level: level.number,
    unit: unit.number,
    unitTitle: unit.name,
    number: lesson.number,
  }] : [];
})));

export function getFluentKidsLesson(id?: string) {
  return publishedLessons.find(lesson => lesson.id === id);
}

export function getFluentKidsLessonHref(id: string) {
  return getFluentKidsLesson(id) ? `${FLUENT_KIDS_PATH}/lesson/${id}` : undefined;
}

export const fluentKidsClassroomMaterials = publishedLessons.map(lesson => ({
  id: lesson.id,
  course: 'young-learners',
  level: lesson.level,
  // The shared classroom picker uses chapter for its grouping field.
  chapter: lesson.unit,
  chapterLabel: `Chapter ${lesson.unit}: ${lesson.unitTitle}`,
  lessonNumber: lesson.number,
  lessonTitle: `Lesson ${lesson.number}: ${lesson.title}`,
  goalTextEn: lesson.goalTextEn,
}));

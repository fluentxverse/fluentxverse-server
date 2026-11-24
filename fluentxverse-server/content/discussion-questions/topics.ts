/** Directly authored question banks. No API or model-backed drafting. */
export interface DiscussionTopic {
  level: number;
  number: number;
  title: string;
  goal: string;
  description: string;
  questions: string[];
}
function topic(level: number, number: number, title: string, goal: string, description: string, questions: string): DiscussionTopic {
  return { level, number, title, goal, description, questions: questions.trim().split('\n').map(q => q.trim()) };
}
export const discussionTopics: DiscussionTopic[] = [
  topic(1, 1, 'Motorcycle', 'I can talk about motorcycles using simple words.', 'Talk about motorcycles, helmets and short trips. You can imagine the answers; you do not need to ride.', `
Do you see motorcycles near your home?
What colour motorcycle do you like?
Is a motorcycle big or small?
Does a motorcycle have two wheels?
Is a helmet heavy or light?
What colour helmet do you like?
Do you like the sound of motorcycles?
Where can you see a motorcycle?
Do you prefer a motorcycle or a bicycle?
Is a motorcycle easy to park?
What do you wear on your feet for a ride?
Do you like short trips or long trips?
Do you prefer a quiet road or a busy road?
Is rain good weather for a ride?
What can a rider carry in a bag?
Can two friends travel on two motorcycles?
Imagine a red motorcycle. Where is it?
Imagine a rider. What is the rider wearing?
What can you say to a friend before a trip?
What three words can you use to describe a motorcycle?`),
  topic(1, 2, 'Food I Like', 'I can name foods and say what I like.', 'Share simple food preferences and choose an imaginary meal.', `
What food do you like?
Do you like rice?
Do you like bread?
What fruit do you like?
What vegetables do you know?
Is a lemon sweet or sour?
Do you like hot food or cold food?
What colour is your favourite fruit?
What do you drink with lunch?
Do you prefer water or juice?
What food is easy to eat?
What food can you eat with a spoon?
What food can you eat with your hands?
Do you like soup?
What can you put in a sandwich?
What food can you share with a friend?
Imagine a picnic. What food is there?
Imagine a café. What do you order?
What food do you want to try?
What three foods are in your imaginary lunch?`),
  topic(1, 3, 'My Day', 'I can describe a simple daily routine.', 'Talk about everyday activities from morning to night. Real or imagined routines are welcome.', `
Do you get up early or late?
What do you do in the morning?
Do you eat breakfast?
What do you drink in the morning?
Do you walk in the morning?
What do you put in your bag?
Do you study in the morning or afternoon?
Where do you eat lunch?
What do you do after lunch?
Do you listen to music during the day?
What do you do in the evening?
Do you cook dinner?
Do you read at night?
Do you like a busy day?
When do you relax?
What do you do before bed?
Imagine a free morning. What do you do?
Imagine a rainy day. Where do you stay?
What is one good thing in a day?
Can you describe your imaginary day in three sentences?`),
  topic(1, 4, 'Places Around Town', 'I can name places and say where they are.', 'Name familiar places and describe an imaginary town using near, next to and opposite.', `
What places can you name in a town?
Where can you buy bread?
Where can you buy a book?
Where can you drink coffee?
Where can you see trees?
Do you like parks?
Is a supermarket big or small?
What can you see at a station?
Do you prefer a café or a park?
What place is quiet?
What place is busy?
What can you do at a library?
Where can friends meet?
What can you buy at a market?
Imagine a café next to a shop. What is nearby?
Imagine a park opposite a school. Where is the school?
What place do you visit on a free day?
Do you walk or take a bus around town?
What place would you like near your home?
What three places are in your imaginary town?`),
  topic(1, 5, 'Free Time', 'I can talk about simple free-time activities.', 'Choose activities and talk about what you like doing alone or with others.', `
What do you like doing in your free time?
Do you like music?
Do you like drawing?
Do you like reading?
What games do you know?
Do you prefer indoor or outdoor activities?
Do you like walking?
What can you do in a park?
Do you like taking photos?
What do you like watching?
Do you prefer music or a film?
Do you like making things?
What can you do with a friend?
What can you do alone?
What activity is quiet?
What activity is fun on a rainy day?
Imagine a free afternoon. What do you choose?
What do you need for your chosen activity?
What new activity would you like to try?
How do you invite a friend to join you?`),
  topic(1, 6, 'Weather and Clothes', 'I can describe weather and choose clothes.', 'Talk about sunny, rainy, hot and cold days. Choose clothes for an imaginary outing.', `
Is it sunny or cloudy today?
Do you like sunny weather?
Do you like rain?
Do you prefer hot or cold weather?
What do you wear on a hot day?
What do you wear on a cold day?
What colour coat do you like?
Do you like hats?
When do you use an umbrella?
What shoes do you wear in the rain?
Is a scarf for hot or cold weather?
What can you do on a sunny day?
What can you do on a rainy day?
Do you prefer a T-shirt or a shirt?
What clothes are comfortable?
Imagine a cold morning. What do you wear?
Imagine a sunny picnic. What do you bring?
Imagine rain at the park. Where do you go?
What weather is good for a walk?
What three words describe your imaginary outfit?`),
  topic(1, 7, 'Animals Around Us', 'I can describe animals with simple adjectives.', 'Describe animals and choose imaginary favourites. You do not need to have a pet.', `
What animals do you know?
Do you like cats?
Do you like dogs?
What animal is very big?
What animal is very small?
What animal has long ears?
What colour can a bird be?
Can a fish swim?
Can a bird fly?
Does a cat have wings?
What animal is fast?
What animal is slow?
What animals can you see in a park?
Where can a fish live?
What does a rabbit look like?
Do you prefer a cat or a rabbit?
Imagine a friendly dog. What is its name?
Imagine a bird. What colour is it?
What animal would you like to draw?
How can you describe your chosen animal in three words?`),
  topic(1, 8, 'Things at Home', 'I can name objects and describe a room.', 'Describe an imaginary room, its furniture and the positions of everyday objects.', `
What can you see in a kitchen?
What can you see in a bedroom?
What colour chair do you like?
Is a sofa big or small?
What do you put on a table?
Where can you put books?
Do you like bright rooms?
What do you use to tell the time?
What do you use to drink water?
What do you use to open a door?
Is a pillow soft or hard?
Do you prefer a chair or a sofa?
What can you put beside a bed?
What can you put on a wall?
Imagine a cup on a table. Where is the cup?
Imagine a bag under a chair. Where is the bag?
Imagine a small room. What is in it?
What colour are the walls in your imaginary room?
What object is useful in that room?
Can you describe the room in three sentences?`),
  topic(1, 9, 'Getting Around', 'I can name transport and describe a short trip.', 'Choose ways to travel around an imaginary town and ask simple questions.', `
What transport can you name?
Do you like buses?
Do you like trains?
Do you prefer walking or cycling?
What colour bus do you like?
Is a train long or short?
Where do you wait for a bus?
What can you see at a station?
Do you like a window seat?
What do you carry on a short trip?
Do you prefer a quiet bus or a busy bus?
Can you walk to a nearby park?
What transport is good on a rainy day?
What can you do while you wait?
Imagine a bus ticket. Where do you want to go?
Imagine a short train trip. Who goes with you?
What do you say when you ask for a ticket?
What place do you visit after the trip?
How do you get back to the station?
Can you describe your imaginary trip in three sentences?`),
  topic(1, 10, 'A Good Weekend', 'I can choose weekend activities and invite someone.', 'Plan an imaginary weekend with simple activities, places and invitations.', `
Do you like weekends?
Do you get up early on weekends?
What do you like doing on Saturday?
What do you like doing on Sunday?
Do you like going to a park?
Do you like staying at home?
What do you eat on a free morning?
Who can join an imaginary picnic?
What can you bring to the picnic?
What music can you play at home?
Do you prefer a busy or quiet weekend?
What can you do on Saturday evening?
What can you do without a phone?
What activity is good with a friend?
Imagine rain on Sunday. What do you choose?
Imagine a sunny afternoon. Where do you go?
How do you invite someone for a walk?
How do you say no politely?
What is one new thing you want to try?
What are three activities in your imaginary weekend?`),
  topic(2, 1, 'Starting a New Hobby', 'I can describe a hobby and explain a simple choice.', 'Discuss hobbies, beginner steps and a plan to try something new.', `
What hobbies would you like to try?
What do you enjoy doing after a busy day?
Do you prefer making things or playing games?
Which hobby can you do at home?
Which hobby can you do outside?
What do you need to start drawing?
What makes a hobby fun for a beginner?
Would you rather learn alone or with a friend?
How often could someone practise a new hobby?
What hobby is easy to start with little equipment?
What can a beginner do when something is difficult?
Would you prefer a class or a short video lesson?
How can you invite a friend to try a hobby?
What could you say if your friend chooses a different hobby?
Imagine you have one free hour. What could you practise?
Imagine a class is full. What could you do instead?
How can someone make time for a hobby?
What would you ask a hobby teacher?
How could a beginner notice small improvements?
What simple first step would you recommend for your chosen hobby?`),
  topic(2, 2, 'Eating Out Together', 'I can choose a place to eat and explain preferences.', 'Choose a restaurant, compare simple options and handle an imaginary meal problem.', `
What kind of place do you like for lunch?
Do you prefer a small café or a large restaurant?
What do you usually look at first on a menu?
Would you rather eat inside or outside?
What drink would you order with a sandwich?
How do you ask for a menu?
How do you ask about a dish you do not know?
What makes a restaurant comfortable?
Do you prefer trying new food or choosing familiar food?
How can two friends choose different meals?
What could you say if a dish is too spicy for you?
How do you ask for water politely?
Imagine your first choice is not available. What do you order?
Imagine the café is noisy. Where could you sit?
What can friends talk about while waiting?
How do you check that an order is correct?
What could you say if the wrong drink arrives?
How do you thank someone for good service?
What would you tell a friend about an enjoyable meal?
How would you choose a place that suits two different preferences?`),
  topic(2, 3, 'A Trip for One Day', 'I can describe a day-trip plan and a simple alternative.', 'Plan a short imagined visit, prepare a bag and change plans if needed.', `
Where would you like to go for a day?
Would you prefer the sea or the countryside?
Who could join the imaginary trip?
How would you travel there?
What time would you like to leave?
What would you put in a small bag?
What could you do first when you arrive?
Would you bring lunch or buy it there?
What would you like to take photos of?
How could you find the way to a park?
What would you ask at an information desk?
What could you do if it starts raining?
How could you avoid carrying too many things?
What could you do if a bus is late?
Where could friends agree to meet?
What would make the trip relaxing?
How would you choose the time to go home?
What could you tell a friend about the trip afterwards?
What would you change for another visit?
Can you describe your day-trip plan from start to finish?`),
  topic(2, 4, 'Shopping Choices', 'I can compare everyday items and ask simple shop questions.', 'Choose useful items for an imaginary shopping trip without discussing personal finances.', `
What everyday item would you like to choose today?
Do you prefer shopping in a small shop or a large store?
What colours do you like for a bag?
What makes a bag useful?
Do you prefer a light coat or a warm coat?
How do you ask for a different size?
What would you ask before buying shoes?
Would you rather buy one useful item or several small items?
How can a list help someone shop?
What could you check before paying?
Imagine two bags cost the same. How would you choose?
Imagine a shirt does not fit. What would you say?
What could you do if your preferred colour is unavailable?
Would you prefer a gift that is useful or decorative?
How could you choose a gift without knowing someone's size?
What can you say if you only want to look?
How do you politely ask where an item is?
What could make a shopping trip tiring?
How could two friends agree where to shop first?
What three things would you check before choosing your item?`),
  topic(2, 5, 'Learning Something New', 'I can describe a learning routine and ask for help.', 'Talk about useful ways to learn and encourage an imaginary beginner.', `
What would you like to learn this year?
Do you prefer learning in the morning or evening?
Do you like learning with pictures?
What helps you remember a new word?
Would you rather read an example or hear one?
What can someone learn in ten minutes?
How do you ask a teacher to repeat something?
How do you say that you do not understand?
What makes an explanation easy to follow?
Would you prefer studying alone or with a partner?
What could you do after making a mistake?
How can a notebook help a learner?
What could you practise while waiting for a bus?
Imagine a lesson feels too fast. What would you ask?
Imagine a friend feels nervous. What could you say?
How could someone practise a little every day?
What can you do when you need a short break?
How do you know you understand an example?
What small achievement could a beginner celebrate?
What simple learning plan would you suggest for one week?`),
  topic(2, 6, 'Using My Phone', 'I can describe phone activities and simple preferences.', 'Discuss everyday phone uses, polite habits and imagined phone-free activities.', `
What can people do with a phone?
Which phone activity is useful when travelling?
Do you prefer calling or sending a short message?
What kind of photos do you like taking?
When might a paper map be useful?
What can someone do while their phone charges?
Do you prefer short or long messages?
How can you ask a friend to call later?
What makes a message easy to understand?
Where is it polite to turn the sound down?
Imagine a phone has no power. What could its owner do?
Imagine a friend sends an unclear message. What would you ask?
How could you arrange a meeting without sharing a home address?
What could you do before sending a photo of a friend?
Would you like a phone-free lunch with friends?
What activity could replace looking at a phone for ten minutes?
How do you politely say that you cannot reply now?
What would you check before sending a message?
How could someone keep important travel information on paper?
What phone habit would you recommend for a quiet café?`),
  topic(2, 7, 'Meeting New People', 'I can start a friendly conversation and ask simple follow-up questions.', 'Practise friendly introductions and comfortable conversation in imagined social settings.', `
What can you say when you meet someone?
What name would you use for an imaginary character?
How could you introduce a friend?
What can you ask about someone's hobbies?
What topic is easy for a first conversation?
Would you prefer meeting in a café or a park?
How could you find a shared interest?
What can you say when you enjoy the same music?
How do you ask someone to speak more slowly?
What can you say if you forget a name?
How could you invite someone to join a group activity?
What could you say if they cannot join?
Imagine a new classmate is quiet. What friendly question could you ask?
Imagine you do not know a game. How could you ask to learn?
How can you give another person time to answer?
What can you say when you have a different preference?
How could you change an uncomfortable topic politely?
What can you say at the end of a pleasant conversation?
How could you suggest talking again?
Can you act out a short first conversation with your tutor?`),
  topic(2, 8, 'Making Plans with Friends', 'I can suggest a plan and agree on a simple change.', 'Choose an activity, arrange a time and handle an imagined change politely.', `
What activity would you suggest for a free afternoon?
Would you prefer meeting indoors or outdoors?
How do you ask if a friend is free?
What can you say to suggest a time?
Where is an easy place to meet?
What could friends bring for a picnic?
How can you check that everyone understands the plan?
What would you say if the time is too early?
How can you suggest a different place?
What can you do if a friend prefers another activity?
Imagine rain is likely. What is another plan?
Imagine a café is closed. Where could you go?
What message could you send if you are late?
How could you ask a friend to wait somewhere comfortable?
What can you say if you need to cancel?
How can you offer another day politely?
What details belong in a short invitation?
How could you thank someone for making a plan?
What makes a plan easy to follow?
Can you agree on an imaginary Saturday plan with your tutor?`),
  topic(2, 9, 'Helping in Everyday Life', 'I can offer simple help and respond politely.', 'Discuss small acts of help in everyday imagined situations.', `
What small task can you help with?
How do you offer to carry a light bag?
What can you say when someone holds a door?
How do you ask where to put something?
Would you prefer helping in a garden or a kitchen?
What can you do to help prepare a table?
How can you ask before moving another person's things?
What can you say if you cannot help now?
How do you accept help politely?
How do you decline help politely?
Imagine a visitor cannot find a room. What could you say?
Imagine a classmate drops some papers. How could you help?
What could you do if you do not know the answer to a question?
How can you check that your help is useful?
What task is easier with two people?
How can a group share a simple task?
What can you say if you need instructions?
How could you thank a group after an activity?
Why is asking first a good idea?
Can you offer and accept help in a short role-play?`),
  topic(2, 10, 'A Small Celebration', 'I can plan a simple celebration and discuss guests\' preferences.', 'Organise an imaginary celebration without assuming everyone enjoys the same activities.', `
What could a group celebrate?
Would you choose a picnic or an indoor gathering?
What food could you share?
What drinks could you offer?
What simple decorations would you choose?
Would you prefer quiet music or lively music?
What game could guests play?
How could you invite someone politely?
What information should an invitation include?
How could guests tell you about food preferences?
What could a guest do instead of joining a game?
Imagine the room is small. How could you arrange the chairs?
Imagine rain changes the plan. What could you do?
How could friends share preparation tasks?
What could you prepare the day before?
How could you welcome someone who arrives alone?
What could you say if someone leaves early?
How could you thank people for coming?
What would you do to leave the room tidy?
Can you describe a simple celebration plan for six imaginary guests?`),
  topic(3, 1, 'Building a Learning Habit', 'I can explain a learning habit and suggest practical improvements.', 'Compare study routines and help an imaginary learner build a manageable habit.', `
What makes a learning habit easy to continue?
Which skill would you choose to practise regularly?
How can a learner choose a realistic weekly goal?
What is useful about studying at the same time each day?
When might a flexible routine work better?
How could someone practise without buying new materials?
What are the advantages of learning with a partner?
What might make group practice difficult?
How can a learner keep track of small improvements?
What should someone change if a routine becomes tiring?
Imagine a learner misses three days. How could they restart?
Imagine a learner understands lessons but rarely speaks. What could help?
How could someone divide a large task into smaller steps?
What kind of feedback encourages another attempt?
How can a learner decide when to review old material?
What could a practice partner ask instead of giving the answer?
How would you compare practising for accuracy and practising for speed?
What would you suggest to someone who keeps changing goals?
How could a learner test whether a method is useful?
What one-week plan would you design for an imaginary beginner?`),
  topic(3, 2, 'A Comfortable Neighbourhood', 'I can describe local needs and explain a practical suggestion.', 'Discuss places and services in a fictional neighbourhood, including different residents\' needs.', `
What makes a neighbourhood comfortable to spend time in?
Which public place would you include in a new neighbourhood?
Why might a quiet space matter to residents?
What makes a meeting place easy to find?
How could a neighbourhood welcome new residents?
What could make a local notice easy to understand?
How might children and older residents use the same park differently?
What could a shop do to welcome different customers?
Would you prefer more benches or more activity space in a small park?
How can neighbours share suggestions without disturbing one another?
Imagine a street has few places to sit. What would you propose?
Imagine a community room is often empty. How could residents use it?
What information would you need before suggesting a change?
How could a group hear from people who cannot attend a meeting?
What could residents do when they disagree about noise?
How could a small event help people meet?
What might make an event difficult for some residents to attend?
How could a neighbourhood test an idea before making it permanent?
How would you explain your suggestion to someone with a different priority?
Which small improvement would you choose first, and why?`),
  topic(3, 3, 'Choosing a Travel Experience', 'I can compare travel options and explain a balanced choice.', 'Compare imagined trips and discuss comfort, preparation and respect for local places.', `
What do you value most in a short trip?
Would you prefer one place in detail or several quick visits?
What are the advantages of travelling with a small group?
What can be easier about travelling alone?
How could travellers agree on a daily plan?
What would you check before booking an activity?
How might the weather change a travel plan?
Why might leaving free time be useful?
How could a visitor learn about local customs respectfully?
What makes a travel review helpful?
Imagine a popular attraction is crowded. What alternative would you suggest?
Imagine two friends want different activities. How could they compromise?
What could make a cheap trip less convenient?
When might paying more for a nearby location be worthwhile?
How could someone travel with fewer belongings?
What should a visitor ask before photographing people?
How can travellers avoid planning more than they can enjoy?
What would you do if a trip did not match the advertisement?
How would you describe a place without calling it good or bad overall?
Which imagined trip would you choose for three days, and why?`),
  topic(3, 4, 'Working Well Together', 'I can explain group roles and suggest ways to cooperate.', 'Discuss teamwork through a fictional class project or community activity.', `
What makes a group pleasant to work with?
What is useful about agreeing on a clear goal?
How can a group decide who does each task?
Would you prefer choosing a role or trying a new one?
What can someone contribute besides leading?
How can a group check that instructions are understood?
What makes a deadline realistic?
How can a quieter member share an idea?
What could a leader ask before making a decision?
How can teammates offer help without taking over?
Imagine two people both want the same role. What could the group do?
Imagine a task takes longer than expected. How should the group respond?
What could you say when you disagree with a suggestion?
How can a group tell the difference between a mistake and an unclear instruction?
What should happen when someone cannot finish their part?
How could a short meeting save time later?
What makes praise useful to a teammate?
How can a group review its work fairly?
What would you change after an unsuccessful first attempt?
How would you organise a small imaginary project from start to finish?`),
  topic(3, 5, 'What Makes a Good Purchase?', 'I can compare products and explain value beyond price.', 'Use imaginary purchases to discuss quality, usefulness and changing your mind.', `
What makes an everyday item worth buying?
How is a low price different from good value?
What would you check before choosing a school or work bag?
When can a simple product be better than one with many features?
How can a review help someone choose?
What might make a review less useful?
Would you prefer borrowing or buying something used once?
What are the advantages of repairing an item?
When might a second-hand item be a good choice?
How can a shopping list change a decision?
Imagine two products look the same but have different prices. What would you ask?
Imagine a product breaks quickly. What information would you collect?
How could someone explain a problem politely to a shop?
What would you check in a return policy?
Why might the cheapest delivery option not suit everyone?
How could advertising make an unnecessary item feel important?
What can help someone pause before an unplanned purchase?
How would you choose a gift for someone with different tastes?
How could a group compare options without choosing for another person?
What three criteria would you use for an imaginary purchase?`),
  topic(3, 6, 'Making Time for What Matters', 'I can explain priorities and suggest a realistic schedule.', 'Plan a fictional week while balancing responsibilities, rest and unexpected changes.', `
What makes a day feel well organised?
How can someone choose the most important task?
What is useful about writing a short list?
When can a long list become unhelpful?
How might people plan differently for morning and evening tasks?
What can someone do in a short break?
Why might travel time belong in a schedule?
How can a person leave room for unexpected changes?
What makes a request difficult to refuse?
How could someone say they are unavailable politely?
Imagine three tasks are due tomorrow. How would you decide where to start?
Imagine a meeting is cancelled. How could you use the free time?
What could someone change if every day feels too full?
When might doing one task at a time be useful?
How can friends arrange a plan without sending many messages?
What makes rest different from simply doing nothing?
How could someone review a week without blaming themselves?
What could a group stop doing to make time for its main goal?
How can a schedule support a person without controlling every minute?
What would a manageable fictional week include?`),
  topic(3, 7, 'Stories We Recommend', 'I can recommend a story and explain my reasons clearly.', 'Discuss books, films or invented stories without needing specialist knowledge.', `
What makes you interested in a story?
Do you prefer a familiar setting or an unusual one?
What makes a main character memorable?
How can a story be interesting without much action?
Would you rather read a story or watch an adaptation?
What can music add to a scene?
How can humour change a serious story?
What makes a recommendation useful?
How could you describe a story without revealing its ending?
Can you enjoy a story about a character you disagree with?
Imagine a friend dislikes long films. What kind of story would you suggest?
Imagine two readers understand an ending differently. How could they discuss it?
What could make a surprise ending feel fair?
When might a quiet ending work better than a dramatic one?
How can a setting affect a character's choices?
What is the difference between a character's opinion and the story's message?
How might the same event look different to two characters?
What would you ask an author about a fictional story?
How could you recommend something while mentioning one weakness?
What short invented story would you recommend, and to whom?`),
  topic(3, 8, 'Digital Habits and Attention', 'I can compare digital habits and suggest practical boundaries.', 'Discuss everyday attention, messages and useful technology through imagined examples.', `
What makes a digital tool useful rather than distracting?
When do notifications help someone?
When might notifications interrupt an important task?
How could people agree on phone use during a meal?
What makes a group chat easy to follow?
How can a sender make an important message clear?
When might a call be better than several messages?
What could someone do before sharing a friend's photo?
How can a person tell others that a reply will take time?
What activities are easier without a screen?
Imagine a group chat becomes too busy. What would you suggest?
Imagine an unclear message causes disagreement. How could you clarify it?
What can someone do when an app takes more time than planned?
How could a family or group make a shared screen rule?
What might make the same rule difficult for different people?
How can a person keep digital tools without using every feature?
What would you check before forwarding a surprising claim?
How could someone compare an online impression with real experience?
What would a small experiment with fewer notifications look like?
Which digital habit would you test for one week, and how?`),
  topic(3, 9, 'Welcoming Visitors', 'I can explain a welcoming plan and respond to different needs.', 'Prepare an imaginary visit with clear information and flexible choices.', `
What helps a visitor feel comfortable on arrival?
What information would you send before a visit?
How can directions be clear to someone new to an area?
Would you plan every activity or offer choices?
How could you ask about food preferences politely?
What makes a welcome feel friendly rather than overwhelming?
How could a host include time to rest?
What local place would you show an imaginary visitor?
What could a visitor do independently?
How can a host explain a household custom without sounding strict?
Imagine a visitor prefers quiet activities. What would you suggest?
Imagine the visitor arrives late. How could you adjust the plan?
What can you do if you do not share a language well?
How could a guest politely ask for a change?
Why might people interpret the same gesture differently?
How can a host avoid assuming every visitor has the same needs?
What would you ask before posting a photo of the visit?
How could you explain an unfamiliar dish simply?
What could hosts learn from their visitors?
How would you plan a flexible first afternoon for an imaginary guest?`),
  topic(3, 10, 'Small Changes, Less Waste', 'I can compare ways to reduce waste and propose a small experiment.', 'Discuss practical choices without assuming every person has the same facilities or budget.', `
What kinds of everyday items are often thrown away?
What could someone reuse at home?
How can planning a meal reduce unused food?
When might borrowing an item be practical?
What makes a container easy to use again?
How could a group reduce waste at a small event?
Why might a reusable item not suit every situation?
What information would help someone sort local waste correctly?
How could a shop make a lower-waste choice convenient?
What might stop someone from repairing an item?
Imagine a meeting leaves many unused paper sheets. What could change?
Imagine a shared kitchen has forgotten food. What system could help?
How could people discuss waste without blaming one another?
Would you start with packaging, food or broken items? Why?
How can a small group measure whether a change helps?
What could make a well-intended change inconvenient?
How might storage space affect a person's options?
When should a group reconsider an unsuccessful experiment?
How could a successful idea be shared simply?
What small, realistic waste-reduction experiment would you propose?`),
  topic(4, 1, 'Flexible Work, Shared Responsibilities', 'I can compare working arrangements and negotiate a balanced proposal.', 'Discuss a fictional team deciding how to combine flexibility, access and cooperation.', `
What should a team consider before changing its working arrangements?
Which tasks benefit most from being done together?
Which tasks might suit quiet independent work?
How could flexibility help people with different responsibilities?
What difficulties could arise when colleagues follow different schedules?
How can a team judge work without measuring only visible hours?
What makes an online meeting worth attending?
How could newcomers learn informal knowledge in a flexible team?
When might a shared office day be useful?
How can a team avoid expecting immediate replies at all times?
Imagine half a team wants remote work and half wants office work. What would you propose?
Imagine a colleague cannot join an early meeting. What alternatives could help?
How should a team distinguish availability from productivity?
What responsibilities should accompany greater flexibility?
How could managers listen to concerns without promising every preference?
What information would you collect during a trial period?
How might the same arrangement affect different roles unequally?
What would make a compromise fair enough to test?
How should a team explain a decision to someone whose preference was not chosen?
What balanced proposal would you recommend for a three-month trial?`),
  topic(4, 2, 'Designing Better Public Spaces', 'I can weigh competing needs and justify a public-space proposal.', 'Compare hypothetical uses of limited public space and consider who might be left out.', `
What makes a public space welcoming in practice?
How might residents use the same space at different times?
What should planners learn before redesigning a square?
How can seating affect who can spend time somewhere?
What tensions might arise between quiet use and organised events?
How could a public space support people who do not want to buy anything?
When might a temporary design be better than an immediate permanent change?
How can signs be clear without making a space feel restrictive?
Whose views might be missing from a public meeting?
What could reveal whether a space feels comfortable to different users?
Imagine a square can have more trees or a larger event area. How would you compare the options?
Imagine a redesign looks attractive but removes shade. What questions would you ask?
How can accessibility be considered from the start?
What should happen when residents' preferences conflict?
How might maintenance affect the success of a design?
What can visitor numbers tell planners, and what can they miss?
How could a trial gather feedback from occasional users?
When should a space offer different areas rather than one shared use?
How would you explain a trade-off without dismissing someone's needs?
What proposal would you support for a fictional neighbourhood square?`),
  topic(4, 3, 'Trusting Reviews and Recommendations', 'I can assess a recommendation and explain uncertainty.', 'Discuss how people judge recommendations using hypothetical reviews and examples.', `
What makes a recommendation credible to you?
How does a reviewer's purpose affect the usefulness of a review?
What is the difference between a personal preference and a product fault?
Why might two honest reviewers reach opposite conclusions?
What details make a complaint more informative?
How can a very positive review still leave important questions unanswered?
What should someone check when a reviewer received a free item?
When is a small number of detailed reviews useful?
How could a business respond constructively to mixed feedback?
What can a rating average hide?
Imagine a product has high ratings but repeated comments about durability. How would you assess it?
Imagine a friend recommends a service for a different purpose from yours. What would you ask?
How can someone compare information without searching indefinitely?
What would make you revise a first impression?
How should uncertainty appear in a recommendation to another person?
When might direct experience be more useful than an online rating?
How can a reviewer be critical without attacking staff personally?
What responsibility does someone have when repeating an unverified complaint?
How would you explain why a popular choice may not suit everyone?
What checklist would you use before recommending an unfamiliar service?`),
  topic(4, 4, 'Learning Beyond the Classroom', 'I can evaluate learning opportunities and propose a suitable approach.', 'Compare classes, practice projects and informal learning for an imagined adult learner.', `
What can someone learn from a project that a lesson may not teach?
When is structured teaching especially useful?
What makes informal learning difficult to recognise?
How should a learner choose between breadth and depth?
What can a certificate show, and what might it leave unclear?
How can practice connect with a learner's actual goals?
What makes feedback actionable rather than merely encouraging?
When could learning with peers be more useful than working alone?
How might limited time affect the choice of a course?
Why might an experienced learner still need beginner-level practice?
Imagine a course promises rapid mastery. What would you ask before enrolling?
Imagine a learner knows theory but struggles with a real task. What would you suggest?
How could someone demonstrate progress without an exam?
What makes a challenge productive rather than discouraging?
How should a mentor adjust support as a learner improves?
When is it reasonable to stop using a learning method?
What could employers learn from examples of someone's work?
How can a learning plan remain flexible without losing direction?
What trade-off would you accept to make regular practice possible?
What approach would you recommend to an imaginary learner changing fields?`),
  topic(4, 5, 'Tourism and Everyday Life', 'I can compare tourism benefits and costs from different perspectives.', 'Discuss a fictional town considering visitors, residents and local businesses.', `
What might residents value about welcoming visitors?
What pressures could a popular destination face?
How might tourism affect people who do not work in visitor services?
What makes respectful visitor behaviour easier?
How could a town explain local expectations clearly?
When might promoting a less crowded area create new difficulties?
How can businesses benefit without making residents feel excluded?
What should a town ask before advertising a festival widely?
How might seasonal demand affect workers and services?
What information would help distinguish complaints from a wider pattern?
Imagine a narrow street becomes crowded every weekend. What options would you compare?
Imagine a town wants visitors but lacks public toilets. What should it prioritise?
Who should take part in decisions about visitor facilities?
How could a visitor limit disruption without avoiding all local businesses?
What might visitor spending figures fail to show?
How could a town test a crowd-management idea?
When might a restriction move a problem somewhere else?
How should the town explain a decision that disappoints some businesses?
What would count as a better experience for both residents and visitors?
What balanced visitor plan would you recommend for the fictional town?`),
  topic(4, 6, 'Everyday Privacy Choices', 'I can discuss permission and propose practical information-sharing boundaries.', 'Explore hypothetical sharing decisions without disclosing personal information or assuming legal answers.', `
What makes some information feel more personal than other information?
How can the purpose of sharing affect someone's decision?
Why might permission for one use not cover another use?
What should someone ask before sharing a group photo?
How can a request for permission leave room for a genuine refusal?
When might removing a name still leave a person recognisable?
How could a group make its information-sharing habits clearer?
What difficulties arise when one person shares information about several people?
How can convenience influence a privacy decision?
What should a clear explanation of information use include?
Imagine a club wants to post photos from an event. What process would you suggest?
Imagine a friend agrees to a private message being read but not forwarded. What boundary applies?
How should a group respond when a member changes their mind about future sharing?
What makes consent difficult to judge from silence alone?
How could a form offer meaningful choices without overwhelming users?
When might a general summary be preferable to a personal example?
How can a person ask for clarification without sounding suspicious?
What should a team review before reusing an old recording?
How would you explain the difference between access and permission to publish?
What practical sharing rule would you recommend to an imaginary club?`),
  topic(4, 7, 'Convenience and Sustainable Choices', 'I can weigh environmental aims against practical constraints.', 'Evaluate hypothetical everyday changes while considering access, effort and uncertain effects.', `
What makes a convenient option difficult to replace?
How might time, space and cost shape an everyday choice?
When could sharing equipment work well?
What might stop a repair service from being useful to customers?
How can product design make reuse easier?
What information would help compare two packaging options?
Why might the same change work differently in different homes?
How can a group discuss environmental aims without assuming equal resources?
When could a trial be more useful than a broad promise?
What might be missed by counting only the number of items used?
Imagine a café wants fewer disposable cups. What practical obstacles should it consider?
Imagine an office offers reusable containers but nowhere to wash them. What should change?
How can a business make a preferred choice easier rather than merely advertise it?
What should happen if a well-intended change creates more waste elsewhere?
How could users contribute to evaluating a new system?
When might durability matter more than an attractive environmental label?
How could a group compare a small achievable change with an ambitious difficult one?
What would you ask before accepting a claim that a product is greener?
How should an organisation report progress without overstating its impact?
What realistic experiment would you recommend for an imaginary café or office?`),
  topic(4, 8, 'Resolving Everyday Disagreement', 'I can clarify a disagreement and propose a workable next step.', 'Practise separating preferences, facts and assumptions in fictional shared decisions.', `
What makes a disagreement easier to discuss?
How can people identify what they agree on first?
What is the difference between asking for clarification and challenging a person?
How can an assumption turn a small disagreement into a larger one?
When is it useful to describe an effect rather than guess a motive?
How could someone disagree without pretending to agree?
What makes a compromise workable rather than merely equal?
How can a group hear a quieter person's view?
When might taking a break improve a conversation?
What should people do when they remember an agreement differently?
Imagine flatmates disagree about music in a shared room. What would you ask first?
Imagine a project partner misses a deadline. How could you discuss the impact?
How can someone acknowledge a concern without accepting every claim?
When might a trial arrangement help resolve a disagreement?
What could make an apology useful without promising too much?
How can people distinguish a negotiable preference from a firm boundary?
What should happen if one person does not accept the proposed compromise?
How could a written summary prevent another misunderstanding?
When is leaving an issue unresolved for now reasonable?
What next step would you suggest in one of the fictional situations?`),
  topic(4, 9, 'What Counts as Success?', 'I can compare definitions of success and justify suitable criteria.', 'Discuss fictional personal, team and community goals without judging real people\'s lives.', `
How might two people define a successful day differently?
What makes a goal worth pursuing?
When can a visible result hide an important difficulty?
How can a team recognise progress before reaching its final goal?
What are the limits of comparing people with different starting points?
When might changing a goal be a sign of good judgement?
How can a group value reliable everyday work?
What makes feedback more useful than praise alone?
How could a person distinguish their own priorities from others' expectations?
When might a smaller outcome be more meaningful than a larger one?
Imagine an event attracts fewer people but meets their needs well. Was it successful?
Imagine a project finishes early but leaves users confused. How would you evaluate it?
What could numbers reveal about success, and what might they miss?
How should a team account for effort and outcomes together?
When can celebrating a result create pressure on others?
What would make a goal realistic without making it unchallenging?
How can people discuss ambition without dismissing rest or stability?
What could an unsuccessful attempt still teach a team?
How would you choose criteria before starting a fictional project?
What balanced definition of success would you propose for that project?`),
  topic(4, 10, 'A Community Budget Decision', 'I can compare proposals and negotiate priorities within a fixed limit.', 'An imaginary community centre can fund one improvement first. Discuss choices without inventing local facts.', `
What should a community centre consider before choosing an improvement?
How could staff learn what visitors need?
What is the difference between a popular idea and an urgent need?
How might occasional users have different priorities from regular users?
What information would help compare cost and usefulness?
When might maintenance deserve priority over a new activity?
How could a centre include people who cannot attend a meeting?
What makes a decision process understandable?
Why might equal spending not create equal access?
What could a small trial reveal before a larger commitment?
Imagine the centre can improve seating or buy activity equipment first. What would you ask?
Imagine a popular proposal excludes some users. How could it be revised?
How should the centre explain a decision to those who disagree?
What could volunteers contribute without replacing necessary paid work?
How might ongoing costs change the comparison between proposals?
What should happen if the first estimate turns out to be too low?
How can the centre avoid promising every suggested improvement?
When should it review whether the chosen change helped?
What would make you reconsider your preferred option?
Which proposal would you support first, and with what conditions?`),
  topic(5, 1, 'AI Tools and Human Judgement', 'I can evaluate a proposed AI use and defend a proportionate human role.', 'Assess hypothetical AI-assisted tasks without assuming a tool is accurate, neutral or suitable for every purpose.', `
What should determine whether a task is suitable for AI assistance?
How would you distinguish saving effort from improving a decision?
Which parts of a task require understanding its wider context?
What could make an apparently accurate answer misleading?
When should a person verify an output independently?
How might automation change the skills a team needs to maintain?
What would meaningful human oversight involve beyond approving a result?
How could users challenge an automated recommendation?
Who should explain a decision made with assistance from a tool?
What information should a team avoid entering without appropriate permission?
Imagine a team uses AI to summarise complaints. How would you check whose concerns are being lost?
Imagine a draft sounds convincing but includes an unsupported claim. What should happen before use?
How should a team weigh consistency against attention to unusual cases?
When might declining automation be a reasonable professional choice?
What could a pilot measure besides time saved?
How would you prevent a convenient tool from becoming an unquestioned authority?
What should users know about the role of a tool in a service they receive?
How could a team distribute responsibility without blaming the tool for its choices?
What evidence would make you expand or stop a hypothetical trial?
What conditions would you require before recommending AI assistance for the fictional team?`),
  topic(5, 2, 'The Limits of a Single Measure', 'I can critique a measure and propose a more informative evaluation.', 'Explore how fictional organisations use scores and targets, including what the numbers leave out.', `
What makes a measure useful for a particular decision?
How can a clear target improve work while narrowing attention?
What is the difference between measuring an outcome and measuring activity?
When might an average conceal the experience of a smaller group?
How could a target change behaviour in unintended ways?
What would you ask before comparing two teams' results?
How can an organisation include experience that is difficult to count?
When is a rough measure better than having no measure?
What makes a proxy reasonable, and what makes it misleading?
How should uncertainty be communicated in a simple report?
Imagine a service rewards short calls. What important outcomes could be overlooked?
Imagine a school reports higher completion but gives no other context. What would you investigate?
How can a team distinguish genuine improvement from a change in who is being measured?
What would make combining several indicators more useful rather than more confusing?
When should a target be revised instead of pursued more aggressively?
How can people affected by a measure contribute to its design?
What could qualitative examples add without becoming selective anecdotes?
How would you respond when a precise number creates unjustified confidence?
What evidence would challenge your preferred explanation of a result?
What evaluation approach would you propose for one of the fictional services?`),
  topic(5, 3, 'Speaking for Others', 'I can evaluate representation while protecting another person\'s agency.', 'Discuss hypothetical interviews, advocacy and public accounts without requesting anyone\'s private experience.', `
When can sharing someone's account increase understanding?
What is the difference between amplifying a voice and speaking on someone's behalf?
How might a storyteller's purpose differ from a participant's priorities?
What should a person understand before agreeing to a public interview?
Why might removing identifying details be insufficient in a small community?
How can editing preserve meaning while necessarily selecting material?
When might a compelling narrative oversimplify someone's experience?
What could make a request for participation feel difficult to refuse?
How should a project handle a participant who prefers not to contribute?
What responsibilities remain after a story becomes public?
Imagine an interviewee approves a short quotation but not a full recording. How should the team proceed?
Imagine a campaign wants one person to represent a diverse group. What limitations should be stated?
How could participants review intended use without being promised control over every reaction?
When might a general account serve a public purpose better than a personal story?
How should a team respond if a correct quotation creates a misleading overall impression?
What would make follow-up support responsive rather than paternalistic?
How can an advocate acknowledge disagreement within a community?
When might deciding not to publish be the more responsible outcome?
What would you say to a colleague who treats silence as permission?
What principles would guide your fictional interview project's publication decisions?`),
  topic(5, 4, 'Fairness Beyond Equal Treatment', 'I can compare approaches to fairness and explain a justified distinction.', 'Explore fictional allocation decisions while keeping individual circumstances and practical limits in view.', `
What does equal treatment mean in a specific decision?
When could identical support leave people with unequal opportunities?
How might fairness depend on the purpose of a service?
What is the difference between addressing a barrier and guaranteeing an outcome?
How can decision-makers recognise different needs without relying on stereotypes?
What information is relevant to a fair allocation process?
How could requesting too much information create another barrier?
When might a clear rule need a carefully explained exception?
What makes discretion helpful, and what makes it risky?
How should a process allow someone to question a decision?
Imagine a training programme offers the same schedule to everyone. What access problems could remain?
Imagine a centre has limited spaces and several valid priorities. How would you compare allocation methods?
How could a policy explain different support without treating recipients as less capable?
What trade-offs arise between simplicity and attention to individual circumstances?
When should decision-makers consult those affected rather than infer their needs?
How can a review identify exclusion that headline participation figures miss?
What would count as evidence that an exception process is working poorly?
How should a group discuss fairness when no option satisfies every claim?
What would make a decision legitimate even to some people who disagree with it?
What balanced allocation approach would you recommend for the fictional programme?`),
  topic(5, 5, 'Preserving a Place While Changing It', 'I can evaluate development choices without reducing them to a simple opposition.', 'Consider a fictional district balancing maintenance, local identity, access and redevelopment.', `
What aspects of a place might matter beyond its buildings?
How can a district need investment while residents still fear change?
What should be understood before calling a building or service outdated?
Whose experience is included when a plan claims to benefit the community?
How can the costs of inaction be discussed without dismissing displacement concerns?
What distinguishes consultation from merely announcing a decision?
How could residents influence a proposal before its main choices become fixed?
What might a promise of future affordability leave unclear?
How should planners consider people who rent rather than own property?
What would make a relocation offer practically usable?
Imagine a proposal preserves a landmark but displaces nearby businesses. How would you evaluate that compromise?
Imagine residents disagree about renovation and replacement. What information could sharpen the discussion?
How can a committee represent different interests without claiming universal consent?
When might a temporary arrangement offer real help without solving the wider problem?
What should be measured after a plan is implemented, and whose account matters?
How could rising visitor interest alter the benefits of preservation?
What responsibilities might continue after a developer completes construction?
How should uncertainty about future costs affect present commitments?
What would persuade you to revise your initial view of the proposal?
What conditions would you put forward for a fictional district's next planning stage?`),
  topic(5, 6, 'Accountability After a Mistake', 'I can distinguish acknowledgement, repair and prevention in a practical response.', 'Evaluate fictional organisational mistakes without inventing motives, legal conclusions or guaranteed recovery.', `
What should an initial response establish before offering an explanation?
How can an organisation acknowledge harm without claiming facts it has not confirmed?
What distinguishes an explanation from an excuse?
When might an immediate apology be incomplete without practical action?
How should responsibility be shared when several decisions contributed to a failure?
What could affected people need that an organisation's preferred response misses?
How can a correction be accurate yet insufficient to repair trust?
What does a useful review examine beyond the final error?
How can a team encourage reporting without removing individual responsibility?
What would make a promise of prevention credible?
Imagine a service sends customers incorrect information. What should happen first and next?
Imagine a team blames one employee despite unclear instructions. What would you investigate?
How should an organisation communicate what remains unknown?
When might public transparency conflict with another person's privacy?
What would meaningful follow-up look like several weeks later?
How can a revised procedure be tested rather than simply announced?
What should leaders do if the preferred remedy is rejected by those affected?
When is it reasonable to say trust is improving, and what would not justify that claim?
How could a review preserve learning without turning every mistake into a public spectacle?
What response plan would you propose for one of the fictional organisations?`),
  topic(5, 7, 'Moderating a Shared Online Space', 'I can justify discussion rules and evaluate difficult boundary cases.', 'Design a fictional community forum that supports disagreement, participation and clear moderation.', `
What is the main purpose of the online space you would design?
How should that purpose influence its discussion rules?
What distinguishes criticism of an idea from an attack on a participant?
How can rules protect participation without promising that nobody will feel challenged?
What makes a moderation decision understandable?
When might context change the meaning of an apparently similar comment?
How could frequent contributors unintentionally dominate a discussion?
What would make an appeal process meaningful?
How should moderators acknowledge mistakes in their own decisions?
What information should a forum provide about how its rules are enforced?
Imagine a heated disagreement includes both useful criticism and personal remarks. How would you respond?
Imagine a rule is applied consistently but excludes a legitimate kind of discussion. What should change?
How could a forum distinguish repeated disruption from an unpopular viewpoint?
What are the limits of relying only on user reports?
When might slowing a discussion be preferable to closing it?
How can a moderator avoid becoming the judge of every disputed factual claim?
What should happen when a private conflict is brought into a public thread?
How could the forum learn whether quieter members feel able to participate?
What trade-off would you accept to keep moderation manageable?
What initial rules and review process would you propose for the fictional forum?`),
  topic(5, 8, 'Ownership, Access and Shared Resources', 'I can compare shared-use models and propose workable responsibilities.', 'Consider hypothetical shared tools, rooms and services without assuming sharing always improves access.', `
When is access to an item more useful than owning it?
What kinds of resources might suit shared use?
What hidden work is required to keep a sharing arrangement reliable?
How might booking rules advantage some users over others?
What should be agreed before a group buys equipment together?
How can a system balance convenience with careful use?
What distinguishes normal wear from avoidable damage in a shared arrangement?
How could a group handle disagreement about maintenance responsibilities?
When might a small fee improve a service, and when might it exclude people?
What would make information about availability trustworthy?
Imagine a shared workshop has one popular tool and many occasional users. How would you allocate time?
Imagine a shared room is repeatedly left untidy. What response would be proportionate?
How could newcomers learn the system without relying on personal connections?
What would make a deposit system fairer to people with limited resources?
When should a group stop sharing a resource that creates too much administrative work?
How might ownership encourage care, and how could sharing encourage it differently?
What could user numbers hide about who actually benefits?
How should a group decide whether to expand a successful pilot?
What alternative would you consider if a shared model does not meet users' needs?
What agreement would you recommend for a fictional equipment-sharing group?`),
  topic(5, 9, 'Expert Advice and Public Judgement', 'I can distinguish expertise, evidence and value choices in a public decision.', 'Discuss a hypothetical local decision where technical advice informs, but does not settle, every question.', `
What kind of question is an expert particularly well placed to answer?
How does technical expertise differ from authority to make a collective choice?
What should an adviser explain about the limits of an analysis?
How can decision-makers distinguish disagreement about evidence from disagreement about priorities?
When might several experts reasonably reach different conclusions?
What makes a simplified explanation accurate enough to be useful?
How should a group evaluate a confident claim without judging only the speaker's style?
What could lived experience add to a technical assessment?
How can public questions improve rather than merely delay a decision?
When is more information unlikely to resolve a disagreement?
Imagine advisers compare two transport routes with different benefits. What value choices remain for residents?
Imagine a speaker cites one study as decisive. What would you ask about its relevance?
How should uncertainty affect a decision that cannot be postponed indefinitely?
What would make changing a recommendation a sign of good practice?
How could decision-makers explain why they did not follow one part of expert advice?
What is the risk of presenting all opinions as equally supported?
How can an expert acknowledge public concerns without endorsing unsupported claims?
What information should be accessible before a consultation?
How would you identify which unanswered questions genuinely matter to the decision?
What decision process would you recommend for the fictional transport proposal?`),
  topic(5, 10, 'Making Progress Without a Perfect Solution', 'I can defend a limited proposal while explaining its conditions and unresolved issues.', 'Bring together evidence, trade-offs and shared responsibility in an imagined long-term community project.', `
What makes partial progress meaningful rather than merely symbolic?
How can a group set immediate priorities without abandoning a larger goal?
What distinguishes a practical compromise from avoiding a difficult issue?
When could waiting for a perfect plan make a situation worse?
What risks arise when urgency becomes a reason to ignore objections?
How can an agreement preserve room for later revision?
What should be clear before calling a pilot successful?
How might a short-term benefit create a longer-term responsibility?
What would make a review date more than a formality?
How can a group recognise progress while acknowledging who has not benefited?
Imagine a community project can improve access now but cannot solve every cost problem. What conditions would you require?
Imagine a committee agrees on priorities but none are completed yet. How should it report progress?
How can dissent remain visible after a majority decision?
When should a group change direction rather than continue because it has already invested effort?
What information would help separate an implementation problem from a flawed goal?
How can responsibility be shared without becoming so diffuse that nobody follows through?
What could a group learn from people who choose not to participate?
How should leaders respond when an honest progress report feels disappointing?
What would persuade you that a limited improvement deserves continued support?
What proposal would you defend, what would it leave unresolved, and when would you review it?`),
];

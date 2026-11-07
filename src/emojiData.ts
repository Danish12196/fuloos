/**
 * Emoji choices for accounts and categories, grouped and tagged with search words.
 * Money-related groups come first since they suit accounts and budgets best.
 * Each group lists "emoji words" entries separated by "|".
 */
export interface EmojiGroup {
  name: string;
  icon: string;
  items: { emoji: string; words: string[] }[];
}

const raw: [string, string, string][] = [
  [
    "Money",
    "💰",
    "💰 money bag cash savings wealth|💵 dollar banknote cash notes|💶 euro banknote cash|💷 pound banknote cash|💴 yen banknote cash|💸 money wings spending spent pay|💳 credit card debit card payment|🏦 bank account current checking|🪙 coin coins change|🧾 receipt bill invoice|💹 chart yen market stocks|📈 chart up growth investment stocks|📉 chart down loss|📊 bar chart budget report|🐖 pig piggy savings|🐷 pig piggy bank savings|🏧 atm cash machine withdraw|💎 gem diamond jewel valuable|🤑 money face rich|🧮 abacus accounting calculate|💼 briefcase business work salary|🏛️ classical building government tax|🔐 lock key safe vault secure|🪪 id card identification|📒 ledger book accounts|📑 bookmark tabs documents statement|🏷️ label tag price|🎁 gift present|🤝 handshake deal loan|⚖️ balance scale law|🔄 transfer exchange repeat|♻️ recycle refund",
  ],
  [
    "Shopping",
    "🛒",
    "🛒 shopping cart groceries supermarket|🛍️ shopping bags retail mall|🏬 department store mall|🏪 convenience store shop|👗 dress clothes fashion|👕 shirt clothes tshirt|👖 jeans trousers clothes|👟 shoes sneakers trainers|👠 heels shoes|👜 handbag purse|👛 purse wallet|🎒 backpack school bag|👓 glasses eyewear optician|⌚ watch|💍 ring jewelry jewellery|💄 lipstick makeup cosmetics beauty|🧴 lotion skincare toiletries|🪒 razor shaving|🧺 basket laundry|📦 package parcel delivery online order|🛋️ couch sofa furniture|🪑 chair furniture|🖥️ computer desktop electronics|💻 laptop computer electronics|📱 phone mobile smartphone|🎧 headphones audio electronics|📷 camera photo|🕹️ joystick games console|🧸 teddy bear toys kids",
  ],
  [
    "Food",
    "🍔",
    "🍔 burger fast food takeaway|🍕 pizza takeaway|🍟 fries fast food|🌯 wrap shawarma burrito|🥙 falafel pita sandwich shawarma|🥪 sandwich lunch|🍣 sushi japanese|🍜 noodles ramen|🍝 pasta spaghetti|🍛 curry rice|🍚 rice|🥗 salad healthy|🍲 stew pot meal|🍳 cooking breakfast egg|🥐 croissant bakery breakfast|🍞 bread bakery|🧁 cupcake dessert|🍰 cake dessert|🍩 donut doughnut|🍪 cookie biscuit snack|🍫 chocolate snack|🍿 popcorn snack cinema|🍎 apple fruit groceries|🍌 banana fruit|🥑 avocado|🥕 carrot vegetables groceries|🥩 meat steak butcher|🍗 chicken poultry|🐟 fish seafood|🥛 milk dairy|🧀 cheese dairy|🌴 dates palm|☕ coffee cafe tea|🍵 tea green tea|🧃 juice box drink|🥤 soft drink soda cup|🧋 bubble tea boba|💧 water drop|🍽️ dining restaurant plate eat out|🥡 takeout takeaway delivery|🍴 fork knife restaurant|🍦 ice cream dessert",
  ],
  [
    "Home",
    "🏠",
    "🏠 home house rent mortgage|🏡 house garden home|🏢 office building apartment flat|🏗️ construction building|🔑 key rent landlord|🛏️ bed bedroom furniture|🛁 bath bathroom|🚿 shower water|🧹 broom cleaning|🧼 soap cleaning|🧽 sponge cleaning|🪣 bucket cleaning|🧯 fire extinguisher safety|💡 light bulb electricity utilities|🔌 plug electricity power|⚡ lightning electricity power dewa|🔥 fire gas heating|🌡️ thermometer temperature ac|❄️ snow cold air conditioning ac|📶 wifi signal internet broadband|📺 tv television streaming|📡 satellite dish|📞 telephone landline|🛠️ tools repair maintenance|🔧 wrench repair|🪴 plant houseplant|🧺 laundry basket|🗑️ trash bin waste|📬 mailbox post|🐾 paw pet",
  ],
  [
    "Travel",
    "🚗",
    "🚗 car vehicle auto|🚕 taxi cab|🚙 suv car|🏎️ racing car sports|🚌 bus public transport|🚇 metro subway underground|🚆 train rail|🚊 tram|🚲 bicycle bike|🛴 scooter|🏍️ motorbike motorcycle|⛽ fuel petrol gas station|🅿️ parking|🛣️ highway road toll salik|🚦 traffic light|🔧 car service repair|✈️ airplane flight travel|🛫 departure flight|🛳️ cruise ship|⛵ sailboat boat|🧳 luggage suitcase travel|🏨 hotel stay|🏖️ beach holiday vacation|🏝️ island holiday|🗺️ map travel|🧭 compass|🏕️ camping tent|⛰️ mountain hiking|🌍 globe world international|🕌 mosque|🎫 ticket|🛂 passport control visa",
  ],
  [
    "Health",
    "❤️",
    "🏥 hospital health|💊 pill medicine pharmacy|🩺 stethoscope doctor clinic|🦷 tooth dentist dental|👁️ eye optician|🩹 bandage first aid|💉 syringe vaccine injection|🧠 brain mental health therapy|🏋️ gym weights fitness|🤸 exercise fitness|🧘 yoga meditation|🏃 running jogging fitness|⚽ football soccer sport|🏀 basketball sport|🎾 tennis sport|🏊 swimming pool|🚴 cycling|💇 haircut salon barber|💅 nails manicure salon|💆 massage spa|👶 baby child|🍼 baby bottle formula|👨‍👩‍👧 family|🧒 kid child|🎓 graduation school education tuition|🏫 school education|👵 grandmother elderly|🐶 dog pet|🐱 cat pet|🐠 fish pet aquarium|❤️ heart love|🛡️ shield insurance protection|☂️ umbrella insurance",
  ],
  [
    "Fun",
    "🎉",
    "🎉 party celebration|🎂 birthday cake|🎈 balloon party|🎁 gift present|🎄 christmas tree holiday|🌙 crescent moon ramadan eid|🪔 diya lamp diwali|🎬 movie film cinema|🎟️ tickets admission event|🎭 theatre arts|🎤 microphone karaoke concert|🎵 music note|🎶 music notes|🎸 guitar music|🎮 video game gaming|🎲 dice board game|🧩 puzzle|🎨 art painting|📚 books reading|📖 book reading|📰 newspaper news subscription|🎳 bowling|⛳ golf|🎣 fishing|🏄 surfing|🎯 target goal dart|🍻 beers drinks bar|🍷 wine drinks|🥂 cheers champagne celebration|🎰 slot machine casino|🧶 yarn knitting craft|📸 camera photo|🎪 circus tent",
  ],
  [
    "Work",
    "💼",
    "💼 briefcase work job business|🧑‍💻 developer coder work|👩‍💼 office worker|👨‍💼 business man|🏢 office|📝 memo notes|✏️ pencil writing|📎 paperclip office supplies|📌 pin|📅 calendar date schedule|🗓️ calendar spiral|⏰ alarm clock time|⏳ hourglass time|📧 email|📨 envelope incoming mail|🖨️ printer|💾 floppy disk save|☁️ cloud subscription storage|🔒 lock security|🧾 receipt tax expense claim|📋 clipboard list|🗂️ folders files|🔬 microscope science lab|🔭 telescope|⚙️ gear settings|🧰 toolbox|🚀 rocket startup launch|💡 idea|🎯 goal target|🏆 trophy award bonus|🥇 gold medal first",
  ],
  [
    "Nature",
    "🌿",
    "🌿 herb leaf plant|🌱 seedling growth|🌳 tree|🌴 palm tree|🌵 cactus desert|🌸 blossom flower|🌹 rose flower|🌻 sunflower|💐 bouquet flowers|🍀 clover luck|🍁 maple leaf autumn|☀️ sun sunny|🌙 moon night|⭐ star|🌟 glowing star|✨ sparkles|🌈 rainbow|⛅ cloud weather|🌊 wave sea ocean|🏜️ desert|🐪 camel desert|🦅 eagle falcon bird|🐎 horse|🐄 cow|🐑 sheep|🐔 chicken|🦋 butterfly|🐝 bee|🐢 turtle|🦁 lion|🐘 elephant",
  ],
  [
    "Smileys",
    "😀",
    "😀 grinning smile happy|😃 smile happy|😄 laugh happy|😁 grin|😂 laughing tears joy|🙂 slight smile|😊 blush happy|😍 heart eyes love|🥰 hearts love|😎 cool sunglasses|🤓 nerd|🤔 thinking|😐 neutral|😴 sleeping tired|😢 sad cry|😭 crying sob|😡 angry|😱 scream shock|🤯 mind blown|🥳 party celebrate|😇 angel|🤗 hug|🙄 eye roll|😬 grimace|🤒 sick ill|👍 thumbs up ok|👎 thumbs down|👏 clap|🙏 pray thanks please|💪 strong muscle|✌️ peace victory|👋 wave hello",
  ],
  [
    "Symbols",
    "🔷",
    "✅ check done tick|❌ cross no cancel|⭕ circle|❗ exclamation important|❓ question|⚠️ warning alert|🚫 prohibited no|💯 hundred perfect|🔔 bell notification|🔕 mute|📍 location pin|🔷 blue diamond|🔶 orange diamond|🟢 green circle|🟡 yellow circle|🔴 red circle|🔵 blue circle|🟣 purple circle|🟠 orange circle|⚫ black circle|⚪ white circle|🟩 green square|🟦 blue square|🟥 red square|🟨 yellow square|💜 purple heart|💙 blue heart|💚 green heart|💛 yellow heart|🧡 orange heart|🖤 black heart|🤍 white heart|➕ plus add|➖ minus|🔁 repeat recurring|📆 monthly calendar|🇦🇪 uae emirates flag|🇸🇦 saudi arabia flag|🇮🇳 india flag|🇵🇰 pakistan flag|🇬🇧 uk britain flag|🇺🇸 usa america flag|🇪🇺 europe eu flag",
  ],
];

export const emojiGroups: EmojiGroup[] = raw.map(([name, icon, list]) => ({
  name,
  icon,
  items: list.split("|").map((entry) => {
    const [emoji, ...words] = entry.trim().split(/\s+/);
    return { emoji, words };
  }),
}));

/**
 * Emojis whose words (or group name) start with every word in the query.
 * Whole-word matches come first, so "bank" lists 🏦 before 💵 (banknote).
 */
export function searchEmojis(query: string, limit = 120): string[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const seen = new Set<string>();
  const exact: string[] = [];
  const partial: string[] = [];
  for (const group of emojiGroups)
    for (const item of group.items) {
      if (seen.has(item.emoji)) continue;
      const words = [...item.words, group.name.toLowerCase()];
      if (query.trim() === item.emoji) {
        seen.add(item.emoji);
        exact.push(item.emoji);
      } else if (terms.every((t) => words.some((w) => w.startsWith(t)))) {
        seen.add(item.emoji);
        (terms.every((t) => words.includes(t)) ? exact : partial).push(
          item.emoji,
        );
      }
    }
  return [...exact, ...partial].slice(0, limit);
}

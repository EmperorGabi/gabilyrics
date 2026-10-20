// Public-domain hymns used to seed a fresh library.
const Lyrics = require('../shared/lyrics');

const SONGS = [
  ['amazing-grace', 'Amazing Grace', 'John Newton', `[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!
I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
’Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;
’Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
The Lord has promised good to me,
His word my hope secures;
He will my shield and portion be,
As long as life endures.

[Verse 5]
When we’ve been there ten thousand years,
Bright shining as the sun,
We’ve no less days to sing God’s praise
Than when we’d first begun.`],
  ['holy-holy-holy', 'Holy, Holy, Holy', 'Reginald Heber', `[Verse 1]
Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;
Holy, holy, holy! Merciful and mighty!
God in three Persons, blessed Trinity!

[Verse 2]
Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;
Cherubim and seraphim falling down before Thee,
Which wert, and art, and evermore shalt be.`],
  ['it-is-well', 'It Is Well with My Soul', 'Horatio Spafford', `[Verse 1]
When peace like a river attendeth my way,
When sorrows like sea billows roll;
Whatever my lot, Thou hast taught me to say,
It is well, it is well with my soul.

[Chorus]
It is well with my soul,
It is well, it is well with my soul.

[Verse 2]
Though Satan should buffet, though trials should come,
Let this blest assurance control,
That Christ hath regarded my helpless estate,
And hath shed His own blood for my soul.`],
  ['blessed-assurance', 'Blessed Assurance', 'Fanny Crosby', `[Verse 1]
Blessed assurance, Jesus is mine!
O what a foretaste of glory divine!
Heir of salvation, purchase of God,
Born of His Spirit, washed in His blood.

[Chorus]
This is my story, this is my song,
Praising my Savior all the day long;
This is my story, this is my song,
Praising my Savior all the day long.`],
  ['come-thou-fount', 'Come, Thou Fount of Every Blessing', 'Robert Robinson', `[Verse 1]
Come, Thou Fount of every blessing,
Tune my heart to sing Thy grace;
Streams of mercy, never ceasing,
Call for songs of loudest praise.

[Verse 2]
Teach me some melodious sonnet,
Sung by flaming tongues above;
Praise the mount! I’m fixed upon it,
Mount of Thy redeeming love.`],
];

module.exports = function seed() {
  const now = Date.now();
  return SONGS.map(([id, title, author, text]) => ({
    id, title, author, copyright: 'Public domain', source: 'local',
    slides: Lyrics.parse(text), createdAt: now, updatedAt: now,
  }));
};

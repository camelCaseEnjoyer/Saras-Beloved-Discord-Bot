const { Client } = require('discord.js')
const {DISCORD_TOKEN, MONGO_URI} = require('./config.json')

const DEFAULT_COMMAND_PREFIX = '-';
const ALPHANUMERICS_WHITESPACE = 'abcdefghijklmnopqrstuvwxyz1234567890 \t\n';


// Maps strings to functions for easily appling text commands. format is ['Command Name', function (msg) {}] with void return.
const COMMAND_MAP = new Map([
    ['ping', function (msg) {
        console.log('Ping!');
        msg.reply('Pong!');
        return;
    }],
    ['setsaraprefix', function (msg) {
        const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            msg.reply('setPrefix takes one argument: The new character to use as a command prefix.');
            return;
        }
        const newPrefix = splitContents[1];
        if (newPrefix.length > 1) {
            msg.reply('New prefix must be exactly one character.');
            return;
        }
        if (ALPHANUMERICS_WHITESPACE.includes(newPrefix.toLowerCase())) {
            msg.reply('New prefix must be a symbol, not a letter or number.');
            return;
        }
        //TODO: use a database and actually change the prefix.
        return;
    }]
])

// Create a new discord client instance. See https://discord.com/developers/docs/topics/gateway#gateway-intents for the intents we're using.
const client = new Client({ intents: ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES'] });


client.once('ready', () => {
    console.log('Connected to Discord.');
});

// Waits for messageCreate event. Depends on GUILD_MESSAGES intent. Doesn't detect DMs yet.
client.on('messageCreate', msg => {
    // NOTE: If statements are listed in order of precedence. Ignoring our own messages > commands > memes.
    if (msg.author == client.user) {
        console.log('I sent a message!')
        return;
    }
    // ignore case
    const lowerText = msg.content.toLowerCase();

    // TODO: allow guilds to change the command prefix
    // TODO: check for role permissions for major changes
    if (lowerText[0] == DEFAULT_COMMAND_PREFIX) {
        console.log('Processing Command!')
        // Look at just the first word of the command and ignore the prefix. 
        const command = lowerText.split(' ')[0].slice(1);
        if (COMMAND_MAP.has(command)) {
            COMMAND_MAP.get(command)(msg);
        }
        else {
            // Please remove this before release. Anything that's openly printing messages is bad news bears.
            console.log('Received invalid command: ');
            console.log(msg.content);
        }
        return;
    }

    if (lowerText.contains('fight image')) {
        msg.channel.send('https://imgur.com/OSVZKMt');
        return;
    }
});

client.login(DISCORD_TOKEN);
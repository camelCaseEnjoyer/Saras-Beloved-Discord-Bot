const { Client } = require('discord.js')
const { MongoClient } = require('mongodb');
const {DISCORD_TOKEN, MONGO_URI} = require('./config.json')

const DB_NAME = 'Discord-Bot-Info'
const CONFIG_COLLECTION_NAME = 'Server-Config'
const DEFAULT_COMMAND_PREFIX = '-';
const ALPHANUMERICS_WHITESPACE = 'abcdefghijklmnopqrstuvwxyz1234567890 \t\n';

async function getGuildConfigDoc(guildID) {
	const configCollection = dbClient.db(DB_NAME).collection(CONFIG_COLLECTION_NAME);
	var configDoc =  await configCollection.findOne({ _id : guildID });
	return configDoc;
}

async function isCommand(msg) {
	// Don't do a database query on every message, only those that start with symbols
	const firstChar = msg.content.toLowerCase[0];
	if (ALPHANUMERICS_WHITESPACE.includes(firstChar)) {
		return false;
	}
	const configDoc = await getGuildConfigDoc(msg.guild.id);
	// configDoc.prefix is falsey if prefix is not a real field, which we use to our advantage 
	if (configDoc.prefix) {
		return msg.content.charAt(0) == configDoc.prefix;
	}
	else {
		return msg.content.charAt(0) == DEFAULT_COMMAND_PREFIX;
	}
}

// Maps strings to functions for easily appling text commands. format is ['Command Name', function (msg) {}] with void return.
const COMMAND_MAP = new Map([
    ['ping', function (msg) {
        console.log('Ping!');
        msg.reply('Pong!');
        return;
    }],
    ['setsaraprefix', async function (msg) {
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
		// The guild ID serves as the key for our database
		const guildID = msg.guild.id;
		console.log('attempted guild prefix change: ' + guildID + ' ' + newPrefix);
        const filter = { _id : guildID }
		// Create a new document if one doesn't exist
		const options = { upsert: true }
		const updateDoc = { 
		$set: {
			prefix : newPrefix, _id : guildID 
			}
		};
		const collection = dbClient.db(DB_NAME).collection(CONFIG_COLLECTION_NAME);
		const result = await collection.updateOne(filter, updateDoc, options);
		if (result.acknowledged) {
			msg.reply('Mission accomplished. Your new command prefix is ' + newPrefix)
		}
		else {
			msg.reply('Mission failed. Please contact the bot creator and complain.')
			console.log("warning : guild prefix change failed")
		}
        return;
    }]
])

// Create a new discord client instance. See https://discord.com/developers/docs/topics/gateway#gateway-intents for the intents we're using.
const client = new Client({ intents: ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES'] });

// Also create a client to log in to mongodb. Not connected yet.
const dbClient = new MongoClient(MONGO_URI);

client.once('ready', () => {
    console.log('Connected to Discord.');
});

// Waits for messageCreate event. Depends on GUILD_MESSAGES intent. Doesn't detect DMs yet.
client.on('messageCreate', async function(msg) {
    // NOTE: If statements are listed in order of precedence. Ignoring our own messages > commands > memes.
    if (msg.author == client.user) {
        console.log('I sent a message!')
        return;
    }
    // ignore case
    const lowerText = msg.content.toLowerCase();

    // TODO: check for role permissions for major changes
	let command = await isCommand(msg);
    if (command) {
        console.log('Processing Command!')
        // Look at just the first word of the command and ignore the prefix. 
        const command = lowerText.split(' ')[0].slice(1);
        if (COMMAND_MAP.has(command)) {
            COMMAND_MAP.get(command)(msg);
        }
        return;
    }

    if (lowerText.includes('fight image')) {
        msg.channel.send('https://imgur.com/OSVZKMt');
        return;
    }
});

dbClient.connect((err) => {
	if(err) {
		throw err;
	}
	console.log("Connected to Mongodb.")
	client.login(DISCORD_TOKEN);
});
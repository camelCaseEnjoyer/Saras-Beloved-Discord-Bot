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

// Upsert a document, using the filter as the default template for the created document.
async function upsertFilter(collection, filter, updateDoc) {
	updateDoc.$setOnInsert = filter;
	return collection.updateOne(filter, updateDoc, { upsert: true});
}

async function isCommand(msg) {
	// Don't do a database query on every message, only those that start with symbols
	const firstChar = msg.content.toLowerCase[0];
	if (ALPHANUMERICS_WHITESPACE.includes(firstChar)) {
		return false;
	}
	const configDoc = await getGuildConfigDoc(msg.guild.id);
	// configDoc.prefix is falsey if prefix is not a real field, which we use to our advantage 
	if (configDoc && configDoc.prefix) {
		return msg.content.charAt(0) == configDoc.prefix;
	}
	else {
		return msg.content.charAt(0) == DEFAULT_COMMAND_PREFIX;
	}
}

function findChannelByName(guild, name) {
	return guild.channels.cache.find(channel => {
			return channel.toString() == name;
		})
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
		// Searches for a record by guildID, sets prefix and creates the document if it doesn't exist.
        const filter = { _id : msg.guild.id }
		const updateDoc = { 
		$set: {
			prefix : newPrefix 
			}
		};
		const collection = dbClient.db(DB_NAME).collection(CONFIG_COLLECTION_NAME);
		const result = await upsertFilter(collection, filter, updateDoc);
		
		if (result.acknowledged) {
			msg.reply(`Mission accomplished. Your new command prefix is ${newPrefix}.`)
		}
		else {
			msg.reply('Mission failed. Please contact the bot creator and complain.')
			console.log("warning : guild prefix change failed")
		}
        return;
    }],
	['setpinboard', async function(msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            msg.reply('setPinboard takes one argument: The new channel to use as a pinboard.');
            return;
        }
        const channelName = splitContents[1];
		const newPinboard = findChannelByName(msg.guild, channelName)
		if (newPinboard) {
			// console.log(`Found channel: ${newPinboard.toString()}`)
			const filter = { _id : msg.guild.id }
			const updateDoc = { 
			$set: {
					pinboard : newPinboard.id 
				}
			}
			const collection = dbClient.db(DB_NAME).collection(CONFIG_COLLECTION_NAME);
			const result = await upsertFilter(collection, filter, updateDoc);
			if (result) {
				msg.reply(`Change successful! Your new pinboard channel is ${channelName}`);
			}
			else {
				msg.reply('Database error. Please contact the bot creator for details.')
			}
		}
		else {
			// console.log(`could not find channel: ${channelName}`);
			msg.reply(`${channelName} was not found. Please verify spelling, and make sure you have included the # prefix.`);
		}
	}],
	///////// TESTING ONLY: MAKE SURE TO DELETE OR COMMENT THIS COMMAND BEFORE RELEASE /////////
	['deleteallserverdata', async function (msg) {
		const guildID = msg.guild.id;
		result = await dbClient.db(DB_NAME).collection(CONFIG_COLLECTION_NAME).findOneAndDelete({_id : guildID});
		if(result) {
			msg.reply('Everything is gone! Oh no!')
		}
		else {
			msg.reply('Command failed! Oh no!')
		}
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
/*

dbClient.connect((err) => {
	if(err) {
		throw err;
	}
	console.log("Connected to Mongodb.")
	client.login(DISCORD_TOKEN);
});
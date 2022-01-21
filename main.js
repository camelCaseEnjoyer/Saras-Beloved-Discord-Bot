const { Client } = require('discord.js')
const { MongoClient } = require('mongodb');
const {DISCORD_TOKEN, MONGO_URI} = require('./config.json')

const DB_NAME = 'Discord-Bot-Info'
const SERVER_CONFIG_NAME = 'Server-Config'
const CHANNEL_CONFIG_NAME = 'Channel-Config'
const DEFAULT_COMMAND_PREFIX = '-';
const ALPHANUMERICS_WHITESPACE = 'abcdefghijklmnopqrstuvwxyz1234567890 \t\n';
const DEFAULT_MAX_PINS = 20;

class PinLockManager {
	_lockedChannels;
	constructor () {
		this._lockedChannels = [];
	}
	
	async updateChannelPins(channel, guildPinboardID = null) {
		if (this._lockedChannels.indexOf(channel.id) != -1) {
			console.log('Channel is locked. Ending.')
			return true;
		}
		console.log('Channel is unlocked. Let\'s get down to business.');
		this._lockedChannels.push(channel.id);
		let channelConfig = await getChannelConfigDoc(channel.id);
		var pinboardID;
		
		if(channelConfig && channelConfig.pinboard) {
			pinboardID = channelConfig.pinboard;
		}
		else if (guildPinboardID) {
			pinboardID = guildPinboardID;
		}
		else {
			let serverConfig = await getGuildConfigDoc(channel.guild.id);

			if (serverConfig) {
				pinboardID = serverConfig.pinboard
			}
		}
		
		const pinboard = await channel.guild.channels.fetch(pinboardID);
		if(!pinboard) {
			return false;
		}
		
		let pinnedMessages = await channel.messages.fetchPinned();
		console.log(`pinnedMessages.size: ${pinnedMessages.size}`)
		var unpinMessage;
		while(pinnedMessages.size > DEFAULT_MAX_PINS) {
			console.log('We are trying to unpin');
			console.log(`pinnedMessages.size: ${pinnedMessages.size}`)
			unpinMessage = pinnedMessages.at(-1)
			let copy = copyMessage(unpinMessage);
			// Notepad++ is mean about this, but we're using three escaped backticks here
			let sentDate = new Date(unpinMessage.createdTimestamp);
			copy.content = `\`\`\`Sent by ${unpinMessage.author.username} on ${sentDate.toDateString()} at ${sentDate.toTimeString()}:\`\`\`\n${copy.content}`
			await pinboard.send(copy);
			pinnedMessages.delete(pinnedMessages.lastKey());
			await unpinMessage.unpin()
		}
		// Unlock the channel for future pin shenanigans.
		this._lockedChannels.splice(this._lockedChannels.indexOf(channel.id));
		return true;
	}
	
}

async function getGuildConfigDoc(guildID) {
	const configCollection = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
	var configDoc = configCollection.findOne({ _id : guildID });
	return configDoc;
}

async function getChannelConfigDoc(channelID) {
	const configCollection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
	var configDoc = configCollection.findOne({ _id : channelID });
	return configDoc;
}

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

// Finds a channel with a certain name in a specific guild
function findChannelByName(guild, name) {
	return guild.channels.cache.find(channel => {
			return channel.toString() == name;
		})
}

function copyMessage(msg) {
	// Discord is stinky about sending blank messages, even if they have attachments. Therefore, we use this weird string template to add a space at the end.
	let newMessage = { content : `${msg.content} `,
		files : []};
	for (const pair of msg.attachments) {
		// console.log(pair[1].url);
		newMessage.files.push(pair[1].url);
	}
	return newMessage;
	// TODO: Verify this works with non-image files.
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
			const collection = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
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
	['setchannelpinboard', async function (msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            msg.reply('setPinboard takes one argument: The new channel to use as a pinboard.');
            return;
        }
        const channelName = splitContents[1];
		const newPinboard = findChannelByName(msg.guild, channelName)
		if (newPinboard) {
			// console.log(`Found channel: ${newPinboard.toString()}`)
			const filter = { _id : msg.channel.id }
			const updateDoc = { 
			$set: {
					pinboard : newPinboard.id 
				}
			}
			const collection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
			const result = await upsertFilter(collection, filter, updateDoc);
			if (result) {
				msg.reply(`Change successful! The new pinboard for ${msg.channel.toString()} is ${channelName}`);
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
	['help', async function (msg) {
		let currentPrefix = msg.content.charAt(0);
		msg.reply(`Thanks for choosing ${client.user.username} for your pinbot needs. Here's a rundown on all the commands you'll need:\n\n` +
			`**help** - I think you have this one figured out.\n\n` +
			`**setSaraPrefix** - Takes one character as an argument, and changes the default prefix to use my commands. ` +
			`Example: \`\`\`${currentPrefix}setSaraPrefix !\`\`\`\n\n` +
			`**setServerPinboard** - Sets the default pinboard for the entire server. All pin overflow will be sent to that pinboard, ` + 
			`unless you set a channel-specific pinboard with ${currentPrefix}setChannelPinboard. Example: ` +
			`\`\`\`${currentPrefix}setServerPinboard #pins\`\`\`\n\n` +
			`**setChannelPinboard** - As above, but specific to the current channel. This overrides the setServerPinboard command for ` +
			`that channel. Example: \`\`\`${currentPrefix}setChannelPinboard #special-pins\`\`\`\n\n` +
			`**setMaxPins** - Sets how many pins a channel can have before excess pins are sent to the pinboard. Defaults to ${DEFAULT_MAX_PINS}. ` +
			`Example: \`\`\`${currentPrefix}setMaxPins 35\`\`\` [WARNING: Not Yet Implemented!]\n\n` +
			`**blacklistChannel** - Blacklists a channel from unsolicited memery. Does not block pinboard mechanics. Example: ` +
			`\`\`\`${currentPrefix}blacklistChannel\`\`\`\ [WARNING: Not Yet Implemented!]\n\n` + 
			`**unblacklistChannel** - Removes a channel from the blacklist. Example: \`\`\`${currentPrefix}unblacklistChannel\`\`\` ` +
			`[WARNING: Not Yet Implemented!]\n\n` +
			`**updateGuildPins** - Checks all channels for pin overflow, and sends excess messages to the appropriate pinboard. ` +
			`Example: \`\`\`${currentPrefix}updateGuildPins\`\`\` [WARNING: Not Yet Implemented!]\n\n`)
	}],
	}],
	///////// TESTING ONLY: MAKE SURE TO DELETE OR COMMENT THIS COMMAND BEFORE RELEASE /////////
	['deleteallserverdata', async function (msg) {
		const guildID = msg.guild.id;
		result = await dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME).findOneAndDelete({_id : guildID});
		if(result) {
			msg.reply('Everything is gone! Oh no!')
		}
		else {
			msg.reply('Command failed! Oh no!')
		}
	}],
	['copythismessage', async function (msg) {
		// fetchReference returns the originating message of a reply.
		try{
			const toCopy = await msg.fetchReference()
			msg.reply(copyMessage(toCopy));
		} 
		catch (MESSAGE_REFERENCE_MISSING) {
			msg.reply('Originating message not found. Please only use this command in reply to another message.');
			return;
		}
	}]
])

// Create a new discord client instance. See https://discord.com/developers/docs/topics/gateway#gateway-intents for the intents we're using.
const client = new Client({ intents: ['GUILDS', 'GUILD_MESSAGES', 'DIRECT_MESSAGES'] });

// Also create a client to log in to mongodb. Not connected yet.
const dbClient = new MongoClient(MONGO_URI);

// Create a PinLockManager to make sure channels aren't being edited by multiple function instances at the same time.
const pinManager = new PinLockManager();

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

client.on('guildDelete', async function (guild) {
	const guildConfigs = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
	// NOTE: does not yet delete channel configs.
	const result = await guildConfigs.findOneAndDelete({_id : guild.id});
	if(result) {
		console.log(`Removed from guild ${guild.id}, deleted related records.`);
	}
	else {
		console.log(`Removed from guild ${guild.id}, unable to delete records.`);
	}
});

client.on('channelPinsUpdate', async function (channel) {
	console.log(`Updating pins for ${channel.toString()}`)
	let result = await pinManager.updateChannelPins(channel);
	if(result) {
		console.log('No errors reported');
	}
	else {
		console.log('Something went wrong...');
	}
});

dbClient.connect((err) => {
	if(err) {
		throw err;
	}
	console.log('Connected to Mongodb.')
	client.login(DISCORD_TOKEN);
});
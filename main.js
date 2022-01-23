const { Client } = require('discord.js')
const { MongoClient } = require('mongodb');
const {DISCORD_TOKEN, MONGO_URI, ADMIN_USERNAME} = require('./config.json')

const DB_NAME = 'Discord-Bot-Info'
const SERVER_CONFIG_NAME = 'Server-Config'
const CHANNEL_CONFIG_NAME = 'Channel-Config'
const DEFAULT_COMMAND_PREFIX = '-';
const ALPHANUMERICS_WHITESPACE = 'abcdefghijklmnopqrstuvwxyz1234567890 \t\n';
const DEFAULT_MAX_PINS = 40;

class PinLockManager {
	_lockedChannels;
	constructor () {
		this._lockedChannels = [];
	}
	
	async updateChannelPins(channel) {
		if (this._lockedChannels.indexOf(channel.id) != -1) {
			console.log('Channel is locked. Ending.')
			return true;
		}
		this._lockedChannels.push(channel.id);
		var maxPins = DEFAULT_MAX_PINS;
		const serverConfig = await getGuildConfigDoc(channel.guild.id);
		if(serverConfig && serverConfig.maxPins) {
			maxPins = serverConfig.maxPins;
		}
		let channelConfig = await getChannelConfigDoc(channel.id);
		var pinboardID;
		
		if(channelConfig && channelConfig.pinboard) {
			pinboardID = channelConfig.pinboard;
		}
		else if (serverConfig && serverConfig.pinboard) {
			pinboardID = serverConfig.pinboard;
		}
		else {
			return false;
		}
		
		const pinboard = await channel.guild.channels.fetch(pinboardID);

		let pinnedMessages = await channel.messages.fetchPinned();
		console.log(`pinnedMessages.size: ${pinnedMessages.size}`)
		var unpinMessage;
		while(pinnedMessages.size > maxPins) {
			console.log('We are trying to unpin');
			console.log(`pinnedMessages.size: ${pinnedMessages.size}`)
			unpinMessage = pinnedMessages.at(-1)
			let copy = copyMessage(unpinMessage);
			// Notepad++ is mean about this, but we're using three escaped backticks here
			let sentDate = new Date(unpinMessage.createdTimestamp);
			copy.content = `${unpinMessage.url}\n\`\`\`\nAuthor: ${unpinMessage.author.username}\n` +
			`Channel: ${unpinMessage.channel.name}\n` +
			`Date: ${sentDate.toDateString()}\n` +
			`Time: ${sentDate.toTimeString()}\n` +
			`\`\`\`\n${copy.content}`
			
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

async function updateGuildPins(guild) {
	const channels = await guild.channels.fetch();

	const serverConfig = getGuildConfigDoc(guild.id);
	let results = [];
	for (const pair of channels) {
		// Text channels only, please.
		if (pair[1].type == 'GUILD_TEXT') {
			results.push(pinManager.updateChannelPins(pair[1]));
		}
	}
	results = await Promise.all(results);
	if (results.indexOf(false) != -1) {
		return false;
	}
	return true;
}

// Upsert a document lazily. Takes a collection, an ID to use as a filter, and a simple object that shows what to update in the basic form {Field : value}
async function lazyUpsert(collection, ID, updateObj) {
	let filter = {_id : ID}
	let updateDoc = { 
	$set : updateObj,
	$setOnInsert: filter
	}
	return collection.updateOne(filter, updateDoc, {upsert: true});
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

async function isBlacklisted(channel) {
	var collection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
	var configDoc = await collection.findOne({_id : channel.id});
	if(configDoc) {
		return configDoc.blacklisted;
	}
	else {
		return false;
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
}

// Maps strings to functions for easily appling text commands. format is ['Command Name', function (msg) {}] and returns a string for the reply.
const COMMAND_MAP = new Map([
    ['ping', function (msg) {
        return 'Pong!'
    }],
    ['setsaraprefix', async function (msg) {
        const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            return 'setPrefix takes one argument: The new character to use as a command prefix.'
        }
        const newPrefix = splitContents[1];
        if (newPrefix.length > 1) {
            return 'New prefix must be exactly one character.';
        }
        if (ALPHANUMERICS_WHITESPACE.includes(newPrefix.toLowerCase())) {
            return 'New prefix must be a symbol, not a letter or number.';
        }
		
		const collection = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
		const result = await lazyUpsert(collection, msg.guild.id, {prefix : newPrefix});
		
		if (result) {
			return `Mission accomplished. Your new command prefix is ${newPrefix}.`;
		}
		else {
			return `Mission failed. Please contact @${ADMIN_USERNAME} and complain.`;
			
		}
    }],
	['setserverpinboard', async function(msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            return 'setPinboard takes one argument: The new channel to use as a pinboard.';
        }
        const channelName = splitContents[1];
		const newPinboard = findChannelByName(msg.guild, channelName)
		if (newPinboard) {
	
			const collection = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
			const result = await lazyUpsert(collection, msg.guild.id, {pinboard : newPinboard.id});
			if (result) {
				return `Change successful! Your new pinboard channel is ${channelName}`;
			}
			else {
				return 'Database error. Please contact @${ADMIN_USERNAME} for details.';
			}
		}
		else {
			return `${channelName} was not found. Please verify spelling, and make sure you have included the # prefix.`;
		}
	}],
	['setchannelpinboard', async function (msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 2) {
            return 'setPinboard takes one argument: The new channel to use as a pinboard.';
        }
        const channelName = splitContents[1];
		const newPinboard = findChannelByName(msg.guild, channelName);
		if (newPinboard) {
			const collection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
			const result = await lazyUpsert(collection, msg.channel.id, {pinboard : newPinboard.id});
			if (result) {
				pinManager.updateChannelPins(msg.channel);
				return `Change successful! The new pinboard for ${msg.channel.toString()} is ${channelName}`;
			}
			else {
				return `Database error. Please contact @${ADMIN_USERNAME} for details.`
			}
		}
		else {
			// console.log(`could not find channel: ${channelName}`);
			return `${channelName} was not found. Please verify spelling, and make sure you have included the # prefix.`;
		}
	}],
	['help', async function (msg) {
		let currentPrefix = msg.content.charAt(0);
		return `Thanks for choosing ${client.user.username} for your pinbot needs. Here's a rundown on all the commands you'll need:\n\n` +
			`**help** - I think you have this one figured out.\n\n` +
			`**setSaraPrefix** - Takes one character as an argument, and changes the default prefix to use my commands. ` +
			`Example: \`\`\`${currentPrefix}setSaraPrefix !\`\`\`\n\n` +
			`**setServerPinboard** - Sets the default pinboard for the entire server. All pin overflow will be sent to that pinboard, ` + 
			`unless you set a channel-specific pinboard with ${currentPrefix}setChannelPinboard. Example: ` +
			`\`\`\`${currentPrefix}setServerPinboard #pins\`\`\`\n\n` +
			`**setChannelPinboard** - As above, but specific to the current channel. This overrides the setServerPinboard command for ` +
			`that channel. Example: \`\`\`${currentPrefix}setChannelPinboard #special-pins\`\`\`\n\n` +
			`**setMaxPins** - Sets how many pins a channel can have before excess pins are sent to the pinboard. Defaults to ${DEFAULT_MAX_PINS}. ` +
			`Example: \`\`\`${currentPrefix}setMaxPins 35\`\`\`\n\n` +
			`**blacklistChannel** - Blacklists a channel from unsolicited memery. Does not block pinboard mechanics. Example: ` +
			`\`\`\`${currentPrefix}blacklistChannel\`\`\`\n\n` + 
			`**unblacklistChannel** - Removes a channel from the blacklist. Example: \`\`\`${currentPrefix}unblacklistChannel\`\`\`\n\n` +
			`**updateServerPins** - Checks all channels for pin overflow, and sends excess messages to the appropriate pinboard. ` +
			`Example: \`\`\`${currentPrefix}updateServerPins\`\`\`\n\n` +
			`For additional assistance, message @${ADMIN_USERNAME}.`
	}],
	['updateserverpins', async function (msg) {
		const result = await updateGuildPins(msg.guild);
		if(result) {
			return 'Success. Pins should be updated.';
		}
		else {
			return 'Command failed. If you have not yet set a pinboard, please do so with the setServerPinboard or setChannelPinboard commands.';
		}
	}],
	['setmaxpins', async function(msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 2 || isNaN(splitContents[1])) {
            return 'setPinboard takes one argument: The new maximum number of pins before messages are moved into pinboards.';
        }
		
		const newMaxPins = parseInt(splitContents[1]);
		
		if (newMaxPins > 49 || newMaxPins < 0) {
			return 'The number of pins must be between 0 and 49, inclusive on both ends.';
		}
		
		const collection = dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME);
		const result = await lazyUpsert(collection, msg.guild.id, { 'maxPins' : newMaxPins})
		if(result) {
			return `Command successful. The new pin limit for this server is ${newMaxPins}.`;
		}
		else {
			return `Database access failed. Please contact @${ADMIN_USERNAME} for assistance.`;
		}
	
	}],
	['blacklistchannel', async function (msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 1) {
            return 'blacklistChannel takes 0 arguments; simply use it in the channel to be blacklisted.';
        }
		const collection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
		const result = await lazyUpsert(collection, msg.channel.id, {blacklisted : true});
	
		if(result) {
			return `Success! Channel blacklisted.`;
		}
		else {
			return `Database access failed. Please contact @${ADMIN_USERNAME}.`;
		}
	}],
	['unblacklistchannel', async function (msg) {
		const splitContents = msg.content.split(' ');
        if (splitContents.length != 1) {
            return 'unblacklistChannel takes 0 arguments; simply use it in the channel to be blacklisted.';
        }
		const collection = dbClient.db(DB_NAME).collection(CHANNEL_CONFIG_NAME);
		const result = await lazyUpsert(collection, msg.channel.id, {blacklisted : false});
	
		if(result) {
			return `Success! Channel removed from the blacklist.`;
		}
		else {
			return `Database access failed. Please contact @${ADMIN_USERNAME}.`;
		}
	}]
	///////// TESTING ONLY: MAKE SURE TO DELETE OR COMMENT THESE COMMANDS BEFORE RELEASE /////////
	/*
	['deleteallserverdata', async function (msg) {
		const guildID = msg.guild.id;
		result = await dbClient.db(DB_NAME).collection(SERVER_CONFIG_NAME).findOneAndDelete({_id : guildID});
		if(result) {
			return 'Everything is gone! Oh no!'
		}
		else {
			return 'Command failed! Oh no!'
		}
	}],
	['copythismessage', async function (msg) {
		// fetchReference returns the originating message of a reply.
		try{
			const toCopy = await msg.fetchReference()
			return copyMessage(toCopy);
		} 
		catch (MESSAGE_REFERENCE_MISSING) {
			return 'Originating message not found. Please only use this command in reply to another message.';
		}
	}]*/
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
	let blacklisted = await isBlacklisted(msg.channel);
    // ignore case
    const lowerText = msg.content.toLowerCase();

    // TODO: check for role permissions for major changes
	let command = await isCommand(msg);
    if (command) {
        console.log('Processing Command!')
        // Look at just the first word of the command and ignore the prefix. 
        const command = lowerText.split(' ')[0].slice(1);
        if (COMMAND_MAP.has(command)) {
            let response = await COMMAND_MAP.get(command)(msg);
			msg.reply(response);
        }
        return;
    }

    if (lowerText.includes('fight image') && !blacklisted) {
        msg.channel.send('https://imgur.com/OSVZKMt');
        return;
    }
});

client.on('guildCreate', async function (guild) {
	guild.systemChannel.send(`Hello! Thanks for choosing ${client.user.username} for your pinboard needs. Here's how it works:\n` +
	`First, set a serverwide pinboard using **${DEFAULT_COMMAND_PREFIX}setServerPinboard**. \nIf necessary, set channel specific pinboards ` +
	`using **${DEFAULT_COMMAND_PREFIX}setChannelPinboard**. \nThen, either start pinning messages or use the ${DEFAULT_COMMAND_PREFIX}updateServerPins ` +
	`command, and I'll start moving excess pins into your designated pinboard channels. \n\nAny more questions? Use my **${DEFAULT_COMMAND_PREFIX}help** ` +
    `command, or contact @${ADMIN_USERNAME}.`)
})

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
const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const stripBomStream = require('strip-bom-stream');
const csv = require('csv-parser');
const cors = require('cors');
const fs = require('fs');
const { phone } = require('phone');
const redisClientPromise = require('./redisClientPromise');

dotenv.config();

//express setup
const app = express();
app.use(cors());
app.use(bodyParser.json());

const USERS_FILE_NAME = 'accounts.csv';

app.get('/api/users', async (req, res) => {
	const redis = await redisClientPromise;

	//respond with cached users (if available)
	const cachedUsersJson = await redis.get('users');
	if (cachedUsersJson) {
		const cachedUsers = JSON.parse(cachedUsersJson);
		res.json(cachedUsers);
		return;
	}

	//users not cached so load, process, cache, and respond
	const usersStream = fs.createReadStream(USERS_FILE_NAME);
	const users = [];
	usersStream
		.pipe(stripBomStream()) //strip UTF-8 byte order mark (BOM) from stream
		.pipe(csv())
		.on('data', data => users.push(data))
		.on('end', () => {
			//convert numeric values in users[] from string to number
			for (let user of users) {
				for (let key in user) {
					const isNum = !isNaN(user[key]);
					if (isNum) {
						user[key] = +user[key];
					}
				}
			}

			//format users[].phone to be E.164 compliant
			for (let user of users) {
				const phoneData = phone(user.phone, {country: user.country});
				if (phoneData.isValid) {
					user.phone = phoneData.phoneNumber;
				}
			}

			//cache users
			redis.set('users', JSON.stringify(users));

			res.json(users);
		});
	usersStream.on('error', err => {
		res.status(500);
		res.send(`Failed to load ${USERS_FILE_NAME} because: ${err}`);
	});
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on port ${port}...`));

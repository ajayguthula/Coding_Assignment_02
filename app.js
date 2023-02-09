const express = require("express");
const path = require("path");
const encrypt = require("bcrypt");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
let database = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log(`Server is running at http://localhost:3000/`);
    });
  } catch (error) {
    console.log(`DB ${error}`);
    process.exit(1);
  }
};
initializeDBAndServer();

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
    if (jwtToken === undefined) {
      response.status(401);
      response.send(`Invalid JWT Token`);
    } else {
      jwt.verify(jwtToken, "AJAYKUMARGUTHULA", async (error, payload) => {
        if (error) {
          response.status(401);
          response.send(`Invalid JWT Token`);
        } else {
          request.userName = payload.username;
          const userIdQuery = `SELECT user_id FROM user WHERE username = '${payload.username}'`;
          const userCurrentId = await database.get(userIdQuery);
          request.userId = userCurrentId.user_id;
          next();
        }
      });
    }
  } else {
    response.status(401);
    response.send(`Invalid JWT Token`);
  }
}

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser !== undefined) {
    response.status(400);
    response.send(`User already exists`);
  } else {
    const passwordLength = password.length < 6;
    if (passwordLength) {
      response.status(400);
      response.send(`Password is too short`);
    } else {
      const hashedPassword = await encrypt.hash(password, 10);
      const postTwitterQuery = `INSERT INTO user (username, password, name, gender)
      VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      const postTwitter = await database.run(postTwitterQuery);
      response.status(200);
      response.send(`User created successfully`);
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await encrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "AJAYKUMARGUTHULA");
      response.send({ jwtToken });
      next();
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const userFollowingQuery = `
  SELECT * FROM follower JOIN user ON user.user_id = follower.following_user_id
  JOIN tweet ON following_user_id = tweet.user_id
  WHERE follower.follower_user_id = ${userId} 
  ORDER BY tweet.date_time DESC LIMIT 4`;
  const userFollowing = await database.all(userFollowingQuery);
  response.send(
    userFollowing.map((item) => {
      return {
        username: item.username,
        tweet: item.tweet,
        dateTime: item.date_time,
      };
    })
  );
});
app.get("/user/following/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const getFollowingQuery = `SELECT name FROM follower JOIN user ON user_id = following_user_id
  WHERE follower_user_id = '${userId}'`;
  const getFollowing = await database.all(getFollowingQuery);
  response.send(getFollowing);
});
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const getFollowingQuery = `SELECT name FROM follower JOIN user ON user_id = follower_user_id
  WHERE following_user_id = '${userId}'`;
  const getFollowing = await database.all(getFollowingQuery);
  response.send(getFollowing);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const { tweetId } = request.params;

  const tweetsQuery = `
   SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
  const tweetResult = await database.get(tweetsQuery);
  const userFollowersQuery = `
  SELECT * FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${userId}`;

  const userFollowers = await database.all(userFollowersQuery);

  if (
    userFollowers.some((item) => item.following_user_id === tweetResult.user_id)
  ) {
    const likesCountQuery = `SELECT count(like_id) as likes FROM tweet 
    JOIN like ON tweet.tweet_id = like.tweet_id WHERE tweet.tweet_id = ${tweetId}`;
    const likesCount = await database.get(likesCountQuery);

    const repliesCountQuery = `SELECT count(reply_id) as replies FROM tweet 
    JOIN reply ON tweet.tweet_id = reply.tweet_id WHERE tweet.tweet_id = ${tweetId}`;
    const repliesCount = await database.get(repliesCountQuery);

    const queryResult = {
      tweet: tweetResult.tweet,
      likes: likesCount.likes,
      replies: repliesCount.replies,
      dateTime: tweetResult.date_time,
    };

    response.send(queryResult);
  } else {
    response.status(401);
    response.send(`Invalid Request`);
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const userId = request.userId;
    const { tweetId } = request.params;

    const tweetsQuery = `
   SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweetResult = await database.get(tweetsQuery);
    const userFollowersQuery = `
  SELECT * FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${userId}`;

    const userFollowers = await database.all(userFollowersQuery);

    if (
      userFollowers.some(
        (item) => item.following_user_id === tweetResult.user_id
      )
    ) {
      const likedPersonsQuery = `SELECT * FROM tweet
          JOIN like ON tweet.tweet_id = like.tweet_id 
          JOIN user ON user.user_id = like.user_id WHERE tweet.tweet_id = ${tweetId}`;
      const likedPersons = await database.all(likedPersonsQuery);
      let userNamesArray = [];
      const declaration = () => {
        likedPersons.map((item) => {
          userNamesArray.push(item.username);
        });
        return userNamesArray;
      };
      userNamesArray = { likes: declaration() };
      response.send(userNamesArray);
    } else {
      response.status(401);
      response.send(`Invalid Request`);
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const userId = request.userId;
    const { tweetId } = request.params;

    const tweetsQuery = `
   SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweetResult = await database.get(tweetsQuery);
    const userFollowersQuery = `
  SELECT * FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${userId}`;

    const userFollowers = await database.all(userFollowersQuery);
    if (
      userFollowers.some(
        (item) => item.following_user_id === tweetResult.user_id
      )
    ) {
      const repliedPersonsQuery = `SELECT * FROM tweet
          JOIN reply ON tweet.tweet_id = reply.tweet_id 
          JOIN user ON user.user_id = reply.user_id WHERE tweet.tweet_id = ${tweetId}`;
      const repliedPersons = await database.all(repliedPersonsQuery);
      let nameRepliesArray = [];
      const declaration = () => {
        repliedPersons.map((item) => {
          nameReplyObject = {
            name: item.name,
            reply: item.reply,
          };
          nameRepliesArray.push(nameReplyObject);
        });
        return nameRepliesArray;
      };
      nameRepliesArray = { replies: declaration() };
      response.send(nameRepliesArray);
    } else {
      response.status(401);
      response.send(`Invalid Request`);
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const userId = request.userId;

  const tweetsQuery = `
   SELECT * FROM tweet WHERE user_id = ${userId}`;
  const tweetResult = await database.all(tweetsQuery);
  const length = Object.keys(tweetResult).length;
  likesRepliesArray = [];
  tweetResult.map(async (item) => {
    tweetId = item.tweet_id;
    const likesCountQuery = `SELECT * FROM tweet JOIN like ON
      tweet.tweet_id = like.tweet_id WHERE tweet.tweet_id = ${tweetId}`;
    const likesCount = await database.all(likesCountQuery);

    const repliesCountQuery = `SELECT * FROM tweet 
      JOIN reply ON tweet.tweet_id = reply.tweet_id WHERE tweet.tweet_id = ${tweetId}`;
    const repliesCount = await database.all(repliesCountQuery);

    let queryResult = {
      tweet: item.tweet,
      likes: Object.keys(likesCount).length,
      replies: Object.keys(repliesCount).length,
      dateTime: item.date_time,
    };
    likesRepliesArray.push(queryResult);
    arrayLength = Object.keys(likesRepliesArray).length;

    if (length === arrayLength) {
      response.send(likesRepliesArray);
    }
  });
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const { tweet } = request.body;
  const d = new Date();
  let date = new Date(d);
  const month =
    date.getMonth().toString().length === 1
      ? `0${date.getMonth() + 1}`
      : date.getMonth();
  const dates =
    date.getDate().toString().length === 1
      ? `0${date.getDate()}`
      : date.getDate();
  const hour =
    date.getHours().toString().length === 1
      ? `0${date.getHours()}`
      : date.getHours();
  const minute =
    date.getMinutes().toString().length === 1
      ? `0${date.getMinutes()}`
      : date.getMinutes();
  const second =
    date.getSeconds().toString().length === 1
      ? `0${date.getSeconds()}`
      : date.getSeconds();

  const dateTime = `${date.getFullYear()}-${month}-${dates} ${hour}:${minute}:${second}`;

  const tweetLengthQuery = `SELECT * FROM tweet`;
  const tweets = await database.all(tweetLengthQuery);
  const tweetLength = Object.keys(tweets).length;
  const tweetId = tweetLength + 1;
  const postTweetsQuery = `INSERT INTO tweet (tweet_id,tweet, user_id, date_time)
   VALUES (${tweetId},'${tweet}', ${userId}, '${dateTime}')`;
  const tweetResult = await database.run(postTweetsQuery);
  response.send(`Created a Tweet`);
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const userId = request.userId;
    const { tweetId } = request.params;

    const tweetsQuery = `
    SELECT * FROM tweet WHERE tweet_id = ${tweetId}`;
    const tweetResult = await database.get(tweetsQuery);
    if (tweetResult.user_id === userId) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId}`;
      await database.run(deleteTweetQuery);
      response.send(`Tweet Removed`);
    } else {
      response.status(401);
      response.send(`Invalid Request`);
    }
  }
);

module.exports = app;

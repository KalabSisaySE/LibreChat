require('dotenv').config();
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..') });
const cors = require('cors');
const axios = require('axios');
const express = require('express');
const compression = require('compression');
const passport = require('passport');
const mongoSanitize = require('express-mongo-sanitize');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { jwtLogin, passportLogin } = require('~/strategies');
const { connectDb, indexSync } = require('~/lib/db');
const { isEnabled } = require('~/server/utils');
const { ldapLogin } = require('~/strategies');
const { logger } = require('~/config');
const validateImageRequest = require('./middleware/validateImageRequest');
const errorController = require('./controllers/ErrorController');
const configureSocialLogins = require('./socialLogins');
const AppService = require('./services/AppService');
const staticCache = require('./utils/staticCache');
const noIndex = require('./middleware/noIndex');
const routes = require('./routes');
const User = require('~/models/User');
const Balance = require('~/models/Balance')
const Conversation = require('~/models/schema/convoSchema');
const Message = require('~/models/schema/messageSchema');
const {comparePassword} = require("~/models/userMethods");
const {registerUser} = require("~/server/services/AuthService");
const {Transaction} = require("~/models/Transaction");

const { PORT, HOST, ALLOW_SOCIAL_LOGIN, DISABLE_COMPRESSION } = process.env ?? {};

const port = Number(PORT) || 3080;
const host = HOST || 'localhost';

const startServer = async () => {
  if (typeof Bun !== 'undefined') {
    axios.defaults.headers.common['Accept-Encoding'] = 'gzip';
  }
  await connectDb();
  logger.info('Connected to MongoDB');
  await indexSync();

  const app = express();
  app.use(express.json());
  app.disable('x-powered-by');
  await AppService(app);

  const indexPath = path.join(app.locals.paths.dist, 'index.html');
  const indexHTML = fs.readFileSync(indexPath, 'utf8');

  app.get('/health', (_req, res) => res.status(200).send('OK'));

  app.get('/api/check-balance', async (req, res) => {
    const {email, password} = req.query;

    if (!email || !password) {
      return res.status(400).json({error: 'Email and password are required'});
    }

    if (!email.includes('@')) {
      return res.status(400).json({error: 'Invalid email address'});
    }

    if (!process.env.CHECK_BALANCE || isEnabled(process.env.CHECK_BALANCE) === false) {
      return res.status(403).json({error: 'CHECK_BALANCE is not enabled'});
    }

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({error: 'No user with that email was found'});
      }

      // Validate password (assuming you have a method to compare passwords)
      const isPasswordValid = await comparePassword(user, password);

      if (!isPasswordValid) {
        return res.status(401).json({error: 'Invalid password'});
      }

      const balance = await Balance.findOne({user: user._id});
      const tokenCredits = balance ? balance.tokenCredits : 0;

      return res.json({email: user.email, tokenCredits});
    } catch (error) {
      // Send a generic error message to the client
      return res.status(500).json({
        error: 'Internal server error',
        // Expose minimal and non-sensitive information about the error
        errorDetails: error.message // or error.toString()
      });
    }
  });

  app.get('/api/user-conversations', async (req, res) => {
    const {email, password} = req.query;

    if (!email || !password) {
      return res.status(400).json({error: 'Email and password are required'});
    }

    if (!email.includes('@')) {
      return res.status(400).json({error: 'Invalid email address'});
    }

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({error: 'No user with that email was found'});
      }

      // Validate password (assuming you have a method to compare passwords)
      const isPasswordValid = await comparePassword(user, password);
      if (!isPasswordValid) {
        return res.status(401).json({error: 'Invalid password'});
      }

      // Fetch conversations for the user
      const conversations = await Conversation.find({user: user._id}).lean();

      // Fetch messages for each conversation
      const conversationsWithMessages = await Promise.all(
          conversations.map(async (convo) => {
            const messages = await Message.find({conversationId: convo.conversationId}).lean();
            return {
              ...convo,
              messages: messages.map((msg) => ({
                messageId: msg.messageId,
                text: msg.text,
                tokenCount: msg.tokenCount,
                createdAt: msg.createdAt,
              })),
            };
          }),
      );

      return res.json({email: user.email, conversations: conversationsWithMessages});
    } catch (error) {
      // Send a generic error message to the client
      return res.status(500).json({
        error: 'Internal server error',
        // Expose minimal and non-sensitive information about the error
        errorDetails: error.message // or error.toString()
      });
    }
  });

  app.post('/api/create-user', async (req, res) => {
    try {
      const {email, name, username, password, emailVerified = true} = req.body;


      // Validate input
      if (!email || !name || !username) {
        return res.status(400).json({
          error: 'Email, name, and username are required.',
        });
      }

      if (!email.includes('@')) {
        return res.status(400).json({error: 'Invalid email address'});
      }

      const existingUser = await User.findOne({$or: [{email}, {username}]});
      if (existingUser) {
        return res.status(409).json({
          error: 'A user with that email or username already exists',
        });
      }

      // Default password generation if not provided
      const userPassword = password || Math.random().toString(36).slice(-18);
      if (!password) {
        console.log('Generated password: ', userPassword);
      }

      const user = {email, password: userPassword, name, username, confirm_password: userPassword};


      const result = await registerUser(user, {emailVerified});

      if (result.status !== 200) {
        return res.status(result.status).json({error: result.message});
      }

      const userCreated = await User.findOne({$or: [{email}, {username}]});
      if (userCreated) {
        return res.status(201).json({
          message: 'User created successfully',
          emailVerified: userCreated.emailVerified,
        });
      }
    } catch (error) {
      console.error('Error creating user:', error.message);
      return res.status(500).json({error: 'Internal Server Error', errorDetails: error.message});
    }
  });

  app.post('/api/add-balance', async (req, res) => {

    try {
      const {email, amount} = req.body;
      // Validate environment settings
      if (!process.env.CHECK_BALANCE || isEnabled(process.env.CHECK_BALANCE) === false) {
        return res.status(400).json({error: 'CHECK_BALANCE environment variable is not properly set!'});
      }

      // Validate email
      if (!email || !email.includes('@')) {
        return res.status(400).json({error: 'Invalid email address!'});
      }

      // Validate and default amount
      const validAmount = amount ? +amount : 1000; // Default to 1000 if amount is not provided

      // Find user by email
      const user = await User.findOne({email}).lean();
      if (!user) {
        return res.status(404).json({error: 'No user with that email was found!'});
      }

      // Create transaction
      const transaction = await Transaction.create({
        user: user._id,
        tokenType: 'credits',
        context: 'admin',
        rawAmount: validAmount,
      });

      // Check transaction result
      if (!transaction?.balance) {
        return res.status(500).json({error: 'Something went wrong while updating the balance!'});
      }

      // Success response
      return res.status(200).json({
        message: 'Transaction created successfully!',
        amount: validAmount,
        newBalance: transaction.balance,
      });
    } catch (error) {
      console.error('Error: ', error);
      return res.status(500).json({error: error.message});
    }
  });

  app.get('/api/user-stats', async (req, res) => {
    try {

      let users = await User.find({});
      let userData = [];

      for (const user of users) {
        let conversationsCount = await Conversation.countDocuments({ user: user._id }) || 0;
        let messagesCount = await Message.countDocuments({ user: user._id }) || 0;

        userData.push({
          User: user.name,
          Email: user.email,
          Conversations: conversationsCount,
          Messages: messagesCount,
        });
      }

      userData.sort((a, b) => {
        if (a.Conversations !== b.Conversations) {
          return b.Conversations - a.Conversations;
        }

        return b.Messages - a.Messages;
      });

      res.status(200).json(userData);
    } catch (error) {
      console.error('An error occurred:', error);
      res.status(500).json({error: 'Internal Server Error', errorDetails: error.message});
    }
  });

  /* Middleware */
  app.use(noIndex);
  app.use(errorController);
  app.use(express.json({ limit: '3mb' }));
  app.use(mongoSanitize());
  app.use(express.urlencoded({ extended: true, limit: '3mb' }));
  app.use(staticCache(app.locals.paths.dist));
  app.use(staticCache(app.locals.paths.fonts));
  app.use(staticCache(app.locals.paths.assets));
  app.set('trust proxy', 1); /* trust first proxy */
  app.use(cors());
  app.use(cookieParser());

  if (!isEnabled(DISABLE_COMPRESSION)) {
    app.use(compression());
  }

  if (!ALLOW_SOCIAL_LOGIN) {
    console.warn(
      'Social logins are disabled. Set Environment Variable "ALLOW_SOCIAL_LOGIN" to true to enable them.',
    );
  }

  /* OAUTH */
  app.use(passport.initialize());
  passport.use(await jwtLogin());
  passport.use(passportLogin());

  /* LDAP Auth */
  if (process.env.LDAP_URL && process.env.LDAP_USER_SEARCH_BASE) {
    passport.use(ldapLogin);
  }

  if (isEnabled(ALLOW_SOCIAL_LOGIN)) {
    configureSocialLogins(app);
  }

  app.use('/oauth', routes.oauth);
  /* API Endpoints */
  app.use('/api/auth', routes.auth);
  app.use('/api/keys', routes.keys);
  app.use('/api/user', routes.user);
  app.use('/api/search', routes.search);
  app.use('/api/ask', routes.ask);
  app.use('/api/edit', routes.edit);
  app.use('/api/messages', routes.messages);
  app.use('/api/convos', routes.convos);
  app.use('/api/presets', routes.presets);
  app.use('/api/prompts', routes.prompts);
  app.use('/api/categories', routes.categories);
  app.use('/api/tokenizer', routes.tokenizer);
  app.use('/api/endpoints', routes.endpoints);
  app.use('/api/balance', routes.balance);
  app.use('/api/models', routes.models);
  app.use('/api/plugins', routes.plugins);
  app.use('/api/config', routes.config);
  app.use('/api/assistants', routes.assistants);
  app.use('/api/files', await routes.files.initialize());
  app.use('/images/', validateImageRequest, routes.staticRoute);
  app.use('/api/share', routes.share);
  app.use('/api/roles', routes.roles);
  app.use('/api/agents', routes.agents);
  app.use('/api/banner', routes.banner);
  app.use('/api/bedrock', routes.bedrock);

  app.use('/api/tags', routes.tags);

  app.use((req, res) => {
    // Replace lang attribute in index.html with lang from cookies or accept-language header
    const lang = req.cookies.lang || req.headers['accept-language']?.split(',')[0] || 'en-US';
    const saneLang = lang.replace(/"/g, '&quot;'); // sanitize untrusted user input
    const updatedIndexHtml = indexHTML.replace(/lang="en-US"/g, `lang="${saneLang}"`);
    res.send(updatedIndexHtml);
  });

  app.listen(port, host, () => {
    if (host == '0.0.0.0') {
      logger.info(
        `Server listening on all interfaces at port ${port}. Use http://localhost:${port} to access it`,
      );
    } else {
      logger.info(`Server listening at http://${host == '0.0.0.0' ? 'localhost' : host}:${port}`);
    }
  });
};

startServer();

let messageCount = 0;
process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    logger.error('There was an uncaught error:', err);
  }

  if (err.message.includes('fetch failed')) {
    if (messageCount === 0) {
      logger.warn('Meilisearch error, search will be disabled');
      messageCount++;
    }

    return;
  }

  if (err.message.includes('OpenAIError') || err.message.includes('ChatCompletionMessage')) {
    logger.error(
      '\n\nAn Uncaught `OpenAIError` error may be due to your reverse-proxy setup or stream configuration, or a bug in the `openai` node package.',
    );
    return;
  }

  process.exit(1);
});

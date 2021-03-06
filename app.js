const express = require('express');
const compression = require('compression');
const app = express();
const Twit = require('twit');
const passport = require('passport');
const Strategy = require('passport-twitter').Strategy;
const session = require('cookie-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const cfenv = require('./cfenv-wrapper');
var appEnv = cfenv.getAppEnv();
const envVars = appEnv.getEnvVars();
// DB
const nano = require('nano')(appEnv.services['cloudantNoSQLDB'][0].credentials.url);
const dbHandler = nano.use('integri');
const couchDBModel = require('couchdb-model');
const myModel = couchDBModel(dbHandler, {
  views: ['_design/profiles/_view/getUsers']
});
const userModel = require('./models/user')(myModel);
const textModel = require('./models/text')(myModel);
// API Call
const watson = require('./apis/watson')(appEnv);
const google = require('./apis/google')(envVars.youtubeAPIKey, dbHandler, myModel);
const youtube = require('./apis/youtube');
const profile = require('./apis/profile')(myModel, userModel, envVars.youtubeAPIKey, dbHandler, envVars);
const text = require('./apis/texts')(myModel, textModel, dbHandler, envVars);
const external_data = require('./apis/external_data')(myModel, dbHandler);
const newsletter = require('./apis/newsletter')(myModel, dbHandler);

let _secret = "projetointegri2017";

app.use(session({
  name: "session",
  secret: _secret,
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(passport.initialize());
app.use(passport.session());
// Enable reverse proxy support in Express. This causes the
// the "X-Forwarded-Proto" header field to be trusted so its
// value can be used to determine the protocol. See
// http://expressjs.com/api#app-settings for more details.
app.enable('trust proxy');

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, GET");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

if (!appEnv.isLocal){
  app.use((req, res, next) => {
    if (req.secure) {
      next();
    } else {
      res.redirect('https://' + req.headers.host + req.url);
    }
  })
}

const access = require('./apis/access')(dbHandler, envVars, userModel, myModel)
const auth = require('./utils/auth')(passport, userModel, envVars, cookieParser)
const dashboard = require('./apis/dashboard')(dbHandler, myModel, cookieParser, envVars)

// This piece of code should be changed
let port = process.env.PORT || process.env.VCAP_APP_PORT || 3000;
let serverLocation = "localhost"
passport.use(new Strategy({
  consumerKey: envVars.twitterConsumerKey,
  consumerSecret: envVars.twitterConsumerSecret,
  callbackURL: envVars.callbackURL
}, function (token, tokenSecret, profile, cb) {
  let T = new Twit({
    consumer_key: envVars.twitterConsumerKey,
    consumer_secret: envVars.twitterConsumerSecret,
    access_token: token,
    access_token_secret: tokenSecret
  })
  dbHandler.view('profiles', 'getTwitterUsers', {
    keys: [profile.id]
  }, (err, body) => {
    if (!err && body.rows.length > 0) {
      let user = body.rows[0].value;
      return cb(null, user);
    } else {
      T.get('statuses/user_timeline', {
        user_id: profile.id,
        count: 2
      }, (err, data, response) => {
        let tweets = data;
        let allTranslations = [];
        let like = [];
        tweets.forEach(tweet => {
          allTranslations.push(watson.translate(tweet.text))
        })
        Promise.all(allTranslations).then(translations => {
          let analysisQueue = [];
          translations.forEach(trans => {
            analysisQueue.push(watson.analyze(trans));
          })
          Promise.all(analysisQueue).then(analysis => {
            analysis.forEach(sample => {
              sample.categories = sample.categories.filter(cat => {
                if (cat.score > 0.3) {
                  return true;
                }
              })
              sample.categories.forEach(cat => {
                let query = cat.label.split('/');
                like.push(query[query.length - 1])
              })
            });
            let user = userModel;
            user.like = like;
            user.medias.twitter = profile.id;
            user.name = profile.displayName;
            user.profile_image = profile._json.profile_image_url;
            user.created_at = Date.now();
            user.last_change = Date.now();
            user.last_login = Date.now();
            user.location = profile.location
            user.save((err) => {
              if (err) {
                return cb(null, profile);
              } else {
                return cb(null, user);
              }
            })
          })
        }).catch(err => {
          return cb(null, profile);
        })
      })
    }
  })
}));

passport.serializeUser((user, done) => {
  done(null, user)
})

passport.deserializeUser((obj, done) => {
  done(null, obj)
})

app.use(express.static(path.resolve(__dirname, 'dist')))
app.set('views', path.resolve(__dirname, 'dist'))
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);

app.get('/', (req, res) => {
  res.render('index', {
    user: req.user
  })
})

const twitter = require('./apis/twitter.js')(passport, cookieParser, envVars);
const facebook = require('./apis/facebook')(watson, dbHandler, userModel, passport, envVars);
const conversation = require('./apis/conversation')(appEnv, dbHandler, envVars, myModel);
const sources = require('./apis/sources')(dbHandler);
let curatorshipModel = couchDBModel(dbHandler)
const curatorship = require('./apis/curatorship')(dbHandler, curatorshipModel);
app.use('/api/access', access)
app.use('/api/dashboard', dashboard)
app.use('/api/sources', sources)
app.use('/api/curatorship', curatorship)
app.use('/api/twitter', twitter)
app.use('/api/google', google)
app.use('/api/texts', text)
app.use('/api/conversation', conversation)
app.use('/api/profile', profile)
app.use('/api/facebook', facebook)
app.use('/api/external', external_data)
app.use('/api/newsletter', newsletter)
app.post('/api/access_denied', (req, res) => {
  try {
    let status = req.body.access_status
    req.session.denied = status;
  } catch (ex) {
    req.session.denied = false;
  }
  res.end();
})

app.listen(port, () => {
  console.log('running on port: ', port)
})
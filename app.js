var createError = require('http-errors');
var express = require('express');
var uuid = require('uuid/v4');
var session = require('express-session');
var path = require('path');
var requestIp = require('request-ip');
var randomstring = require("randomstring");
var FileStore = require('session-file-store')(session);
var cookieParser = require('cookie-parser');
var Mysql = require("mysql");
const bcrypt = require('bcrypt');
const saltRounds = 10;
require('dotenv').config()
var moment = require('moment');
const crypto = require('crypto-js');
var SHA256 = require("crypto-js/sha256");

var Con;

function handleDisconnect() {

    Con = Mysql.createPool({
      connectionLimit : process.env.DB_LIMIT,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_DB
    });

    Con.on('enqueue', function () {
      return console.error(Chalk.blue('[') + Chalk.yellow(`SHARD[${Shard.id}]`) + Chalk.blue(']') + ' ' + Chalk.white('>') + ' ' + Chalk.cyan('MYSQL') + ' ' + Chalk.white('>') + ' ' + Chalk.yellow('Waiting for available connection slot'))
    });
}

handleDisconnect();

//The lanuch of the express aoo
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
//Extra startup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public/images')));

//Get the full url
app.all("*", function (req, res, next) {
    req.fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    req.fullUrlOU = req.protocol + '://' + req.get('host');
    next()
});

//The "real" ip of the user.
app.use(requestIp.mw())

//
app.use(session({
    genid: (req) => {
        return uuid() // use UUIDs for session IDs
    },
    store: new FileStore(),
    secret: randomstring.generate(),
    resave: false,
    saveUninitialized: true
}));

app.use(async function (req, res, next) {
    if(!req.session.ipCreated) req.session.ipCreated = req.clientIp;
    if(!req.session.cookie.expires || !req.session.expiry){
        req.session.cookie.maxAge = Math.floor(Date.now()/1000) + 604800 - 60;
        req.session.expiry = Math.floor(Date.now()/1000) + 604800 - 60;
    }
    if(!req.session.login) req.session.login = {isLogged: false, user: {}};
    if(!req.session.custom || req.session.custom.length <= 0) req.session.custom = {alerts: await getAlerts(), lastupdate: Math.floor(Date.now()/1000), tempAlerts: []};
    if(!req.cookies.notifications) res.cookie('notifications', JSON.stringify([]));
    if(req.session.custom.lastupdate + 60 < Math.floor(Date.now()/1000)){
        req.session.custom.alerts = await getAlerts();
        req.session.custom.lastupdate = Math.floor(Date.now()/1000);
    }
    next();
})

//Home page
app.get('/', async function(req, res, next) {
    res.render('index', {title: "Home", page: "home", req});
})  

//Acount page
app.get('/account/', async function(req, res, next) {
    if(req.session.login.isLogged === false) return res.redirect('/login/');
    Con.query("SELECT id FROM pages WHERE `uuid` = '" + req.session.login.user.uuid + "';", async function(error, result){
        if(error) console.log(error);
        res.render('index', {title: "My Account", page: "account", req, pages: result.length})
    })
})

//book page
app.get('/book/', async function(req, res, next) {
    if(req.session.login.isLogged === false) return res.redirect('/login/');
    Con.query("SELECT * FROM users WHERE `email` = '" + req.session.login.user.email + "' AND `uuid` = '" + req.session.login.user.uuid + "' LIMIT 1;", async function(errorInfo, resultsInfo){
        if(errorInfo) return cancelbook('We had an error checking the email!', error);
        if(resultsInfo.length <= 0) return cancelbook('Email Not Found!');

        Con.query("SELECT * FROM pages WHERE `uuid` = '" + resultsInfo[0].uuid + "';", async function(error, result){
            if(error) return cancelbook('We had an checking your data! Error: ' + error.toString(), error);
            let fixedPages = [];
            result.forEach(async (item, index) => {
                let HashedLockedPassword = SHA256(resultsInfo[0].password + ':' + item.dateCreated + ':' + item.uuid).toString();
                var bytesTitle  = crypto.AES.decrypt(item.title.toString(), HashedLockedPassword);
                var plaintextTitle = bytesTitle.toString(crypto.enc.Utf8);

                var bytesMessage  = crypto.AES.decrypt(item.message.toString(), HashedLockedPassword);
                var plaintextMessage = bytesMessage.toString(crypto.enc.Utf8);
                fixedPages.push({title: plaintextTitle, message: plaintextMessage.replace(new RegExp('%NEWLINE%','g'), "\n"), date: moment((item.dateCreated * 1000)).toNow(true) + ' ago'})
            })
            res.render('index', {title: "My Book", page: "book", req, pages: fixedPages})
        });
    })
    function cancelbook(message, log){
        if(log) console.log(log);
        req.session.custom.tempAlerts.push({type: 'danger', 'message': message});
        res.redirect('/');
    }
})

//Book page add
app.get('/book/add/', async function(req, res, next) {
    if(req.session.login.isLogged === false) return res.redirect('/login/');
    res.render('index', {title: "Add Page", page: "bookadd", req})
})

//Book page add POST
app.post('/book/add/', async function(req, res, next) {
    if(req.session.login.isLogged === false) return res.redirect('/login/');
    //Stringify and then re parse to make sure data is json.
    let data = JSON.parse(JSON.stringify(req.body));

    //Checking Data
    if(!data || data.length <= 0) return cancelbookpage('Missing Signup Data!');
    if(!data.title) return cancelbookpage('Missing Title!');
    if(!data.message) return cancelbookpage('Missing Message!');
    if(data.title.length > 60) return cancelbookpage('Title to long!');
    if(data.message.length > 1100) return cancelbookpage('Message to long!');
    data.message = data.message.replace(new RegExp('\r?\n','g'), '%NEWLINE%');

    Con.query("SELECT * FROM users WHERE `email` = '" + req.session.login.user.email + "' AND `uuid` = '" + req.session.login.user.uuid + "' LIMIT 1;", async function(error, results){
        if(error) return cancelbookpage('We had an error checking the email!', error);
        if(results.length <= 0) return cancelbookpage('Email Not Found!');

        let timedDate = Math.floor(Date.now()/1000);

        var HashedLockedPassword = SHA256(results[0].password + ':' + timedDate + ':' + results[0].uuid).toString();

        const cipherTitle = crypto.AES.encrypt(data.title, HashedLockedPassword);
        const cipherMessage = crypto.AES.encrypt(data.message, HashedLockedPassword);
        Con.query("INSERT INTO `pages` (`uuid`, `dateCreated`, `title`, `message`) VALUES ('" + results[0].uuid + "', '" + timedDate + "', '" + cipherTitle.toString() + "', '" + cipherMessage.toString() + "');", async function(error2, result2){
            if(error2) return cancelbookpage('We had an submitting your data! Error: ' + error.toString(), error);
            req.session.custom.tempAlerts.push({type: 'success', 'message': 'Your page has been saved!'});
            res.redirect('/book');
        })
        //.toString()
    })



    function cancelbookpage(message, log){
        if(log) console.log(log);
        req.session.custom.tempAlerts.push({type: 'danger', 'message': message});
        res.redirect('/book/add/');
    }
})


//Signup page
app.get('/signup/', async function(req, res, next) {
    if(req.session.login.isLogged === true) return res.redirect('/');
    res.render('index', {title: "Signup", page: "signup", req})
})

//login page
app.get('/login/', async function(req, res, next) {
    if(req.session.login.isLogged === true) return res.redirect('/');
    res.render('index', {title: "Login", page: "login", req})
})


//LogOut page
app.get('/logout/', async function(req, res, next) {
    req.session.regenerate(function(err) {
        if(err){
            res.locals.message = err.message;
            res.locals.error = req.app.get('env') === 'development' ? err : {};
            res.status(500);
            res.render('error');
        } else {
            if(!req.session.custom || req.session.custom.length <= 0) req.session.custom = {alerts: [], lastupdate: (Math.floor(Date.now()/1000) - 90), tempAlerts: []};
            if(!req.cookies.notifications) res.cookie('notifications', JSON.stringify([]));
            req.session.custom.tempAlerts.push({type: 'success', 'message': 'You have been logged out! Please have a good day!'});
            res.redirect('/');
        }
    })
})

//Login Post
app.post('/login/', async function(req, res, next) {
    //Stringify and then re parse to make sure data is json.
    if(req.session.login && req.session.login.isLogged === true) return res.redirect('/');
    let data = JSON.parse(JSON.stringify(req.body));

    //Checking Data
    if(!data || data.length <= 0) return cancellogin('Missing Signup Data!');
    if(!data.email) return cancellogin('Missing Email!');
    if(!data.password) return cancellogin('Missing Password!');

    Con.query("SELECT * FROM users WHERE `email` = '" + data.email + "' LIMIT 1;", async function(error, results){
        if(error) return cancellogin('We had an error checking the email!', error);
        if(results.length <= 0) return cancellogin('Email Not Found!');

        const match = await bcrypt.compare(data.password, results[0].password);
        if(match === true){
            //Reselect user
            Con.query("SELECT * FROM users WHERE `email` = '" + data.email + "' LIMIT 1;", async function(error, resultsRedo){
                if(error) return cancellogin('We had an error recolleting your data!', error);
                if(resultsRedo.length <= 0) return cancellogin('Account not found.!', error);

                resultsRedo[0].password = null;
                //Set logged in as true with user info but no password
                req.session.login = {isLogged: true, user: resultsRedo[0]};
                Con.query("SELECT * FROM recent_logins WHERE `uuid` = '" + resultsRedo[0].uuid + "' ORDER BY loginAt DESC LIMIT 1;", async function(error, resultsLogins){
                    if(error){
                        console.log(error);
                        req.session.custom.tempAlerts.push({type: 'success', 'message': 'Welcome back ' + resultsRedo[0].firstName + '! <a href="/book">Click Here</a> to see your book!'});
                        res.redirect('/');
                    } else {
                        Con.query("INSERT INTO `recent_logins` (`uuid`, `loginAt`) VALUES ('" + results[0].uuid + "', '" + Math.floor(Date.now()/1000) + "');", async function(error){
                            if(error) console.log(error)
                        })
                        if(resultsLogins.length <= 0){
                            req.session.custom.tempAlerts.push({type: 'success', 'message': 'Welcome back ' + resultsRedo[0].firstName + '! <a href="/book">Click Here</a> to see your book!'});
                            res.redirect('/');
                        } else {
                            req.session.custom.tempAlerts.push({type: 'success', 'message': 'Welcome back ' + resultsRedo[0].firstName + '! Haven\'t seen you since ' + moment((resultsLogins[0].loginAt * 1000)).toNow(true) + ' ago! <a href="/book">Click Here</a> to see your book!'});
                            res.redirect('/');
                        }
                    }
                });
                ///Welcome message
                //req.session.custom.tempAlerts.push({type: 'success', 'message': 'Welcome ' + data.firstName + '! Thanks for joining! Please enjoy!'});
            })
        } else {
            cancellogin('Password Or Email Wrong.')
        }
    })

    function cancellogin(message, log){
        if(log) console.log(log);
        req.session.custom.tempAlerts.push({type: 'danger', 'message': message});
        res.redirect('/login/');
    }
})
//Signup post
app.post('/signup/', async function(req, res, next) {

    //Stringify and then re parse to make sure data is json.
    let data = JSON.parse(JSON.stringify(req.body));

    //Checking Data
    if(!data || data.length <= 0) return cancelsignup('Missing Signup Data!');
    if(!data.email) return cancelsignup('Missing Email!');
    if(!data.firstName) return cancelsignup('Missing First Name!');
    if(!data.lastName) return cancelsignup('Missing Last Name!');
    if(!data.password) return cancelsignup('Missing Password!');

    //Select a user with the same email
    Con.query("SELECT * FROM users WHERE `email` = '" + data.email + "' LIMIT 1;", async function(error, results){
        //Error Check
        if(error) return cancelsignup('We had an error checking the email!', error);
        //If results are not found start the user creation
        if(results.length <= 0){
            //Hash the password
            var HashedPassword = bcrypt.hashSync(data.password, saltRounds);
            //Insert
            Con.query("INSERT INTO `users` (`uuid`, `firstName`, `lastName`, `email`, `password`, `dateCreated`) VALUES ('" + uuid() + "', '" + data.firstName + "', '" + data.lastName + "', '" + data.email + "', '" + HashedPassword + "', '" + Math.floor(Date.now()/1000) + "')", async function(error, results){
                //Error Check
                if(error){
                    //If Error cancel signup
                    cancelsignup('We had an error creating account!', error);
                } else {
                    //Reselect user
                    Con.query("SELECT * FROM users WHERE `email` = '" + data.email + "' LIMIT 1;", async function(error, results){
                        //Error Check
                        if(error) return cancelsignup('We had an error regetting data!', error);
                        //If no result cancel signup with error
                        if(results.length <= 0) return cancelsignup('We had an error regetting data (result)!', results);
                        //Remove password from selection
                        results[0].password = null;
                        //Set logged in as true with user info but no password
                        req.session.login = {isLogged: true, user: results[0]};
                        ///Welcome message
                        req.session.custom.tempAlerts.push({type: 'success', 'message': 'Welcome ' + data.firstName + '! Thanks for joining! Please enjoy!'});
                        Con.query("INSERT INTO `recent_logins` (`uuid`, `loginAt`) VALUES ('" + results[0].uuid + "', '" + Math.floor(Date.now()/1000) + "');", async function(error){
                            if(error) console.log(error)
                        })
                        //Redirect
                        res.redirect('/');
                    })
                }
            })
        //If email is found
        } else {
            //cancel signup and say email was found.
            cancelsignup('<strong>' + data.email + '</strong> already exist! <a href="/login">Click Here</a> To Login!')
        }
    })

    function cancelsignup(message, log){
        if(log){
            console.log(log)
        }
        req.session.custom.tempAlerts.push({type: 'danger', 'message': message});
        res.redirect('/signup/');
    }
})


async function getAlerts(){
    return new Promise(async function(resolve, reject) {
        Con.query('SELECT * FROM `alerts`', async function(error, results){
            if(error) return reject(error);
            return resolve(results)
        })
    })
}

module.exports = app;

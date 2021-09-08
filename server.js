const express = require('express'),
  app = express(),
  bodyParser = require('body-parser'),
  dotenv = require('dotenv').config(),
  cfenv = require('cfenv'),
  strings = require('./utils/strings.json')

app.use(bodyParser.urlencoded({ extended: false }))

app.use(bodyParser.json())

let NLU_APIKEY, NLU_URL, CLOUDANT_URL, CLOUDANT_API
let moviesDb, naturalLanguageUnderstanding, cloudant
const dbName = 'movies-reviews'

if (dotenv.error) {
  //Local file not found. Get creds from cloud services.
  console.log('dotenv not present, will load vcap on IBM Cloud!')
  const appEnv = cfenv.getAppEnv()
  console.log('outputting appEnv')
  console.log(JSON.stringify(appEnv))
  if (appEnv.services['cloudantNoSQLDB'] || appEnv.getService(/[Cc][Ll][Oo][Uu][Dd][Aa][Nn][Tt]/)) {
    // Load the Cloudant library.
    Cloudant = require('@cloudant/cloudant')

    const cloudantCreds = appEnv.services['cloudantNoSQLDB'][0].credentials
    CLOUDANT_API = cloudantCreds.apikey
    CLOUDANT_URL = cloudantCreds.url
  }
  if (appEnv.services['natural-language-understanding']) {
    nluCreds = appEnv.services['natural-language-understanding'][0].credentials
    NLU_APIKEY = nluCreds.apikey
    NLU_URL = nluCreds.url
  }
} else {
  console.log('local env file found')
  NLU_APIKEY = process.env.NLU_APIKEY
  NLU_URL = process.env.NLU_URL
  CLOUDANT_API = process.env.CLOUDANT_API
  CLOUDANT_URL = process.env.CLOUDANT_URL
}

if (CLOUDANT_API && CLOUDANT_URL) {
  var Cloudant = require('@cloudant/cloudant')
  // use IAM here
  cloudant = Cloudant({
    url: CLOUDANT_URL,
    plugins: { iamauth: { iamApiKey: CLOUDANT_API } },
  })
  // Create a new "moviesDb" database.
  cloudant.db.create(dbName, function (err, data) {
    if (!err)
      //err if database doesn't already exists
      console.log('Created database: ' + dbName)
  })
  moviesDb = cloudant.db.use(dbName)
}

if (NLU_APIKEY && NLU_URL) {
  const NaturalLanguageUnderstandingV1 = require('ibm-watson/natural-language-understanding/v1')
  const { IamAuthenticator } = require('ibm-watson/auth')

  naturalLanguageUnderstanding = new NaturalLanguageUnderstandingV1({
    version: '2020-08-01',
    authenticator: new IamAuthenticator({
      apikey: NLU_APIKEY,
    }),
    serviceUrl: NLU_URL,
  })
}

app.get('/', (req, res, next) => {
  errors = checkServiceCredentials()
  if (errors && errors.length > 0) {
    res.render('index.ejs', { msg: { errors: errors } })
  }
  res.render('index.ejs', { msg: {} })
})

app.get('/reviews', (req, res) => {
  const reviews = []
  const errors = checkServiceCredentials()

  if (errors && errors.length > 0) {
    res.render('reviews.ejs', { msg: { errors: errors } })
  }
  moviesDb.list({ include_docs: true }, function (err, body) {
    if (err) {
      res.render('reviews.ejs', {
        msg: { errors: [strings.CLOUDANT_ERROR + ' ' + err.message] },
      })
    }
    res.render('reviews.ejs', { msg: { result: body.rows } })
  })
})

app.post('/reviews', (req, res) => {
  const errors = checkServiceCredentials()
  const { first_name: firstName, last_name: lastName, review, movie } = req.body

  if (!firstName || !lastName || !review || !movie) {
    errors.push(strings.INVALID_FORM)
  }

  if (errors && errors.length > 0) {
    res.render('reviews.ejs', { msg: { errors: errors } })
  }
  const doc = {
    firstName: firstName,
    lastName: lastName,
    movie: movie,
    review: review,
  }

  const analyzeParams = {
    text: review,
    features: {
      sentiment: {},
    },
  }

  naturalLanguageUnderstanding
    .analyze(analyzeParams)
    .then((analysisResults) => {
      console.log(JSON.stringify(analysisResults, null, 2))
      doc['sentiment'] = analysisResults.result.sentiment.document.label
      moviesDb.insert(doc, function (err, body, header) {
        if (err) {
          console.log('[moviesDb.insert] ', err.message)
          return
        }
        res.redirect('/reviews')
      })
    })
    .catch((err) => {
      console.log('error:', err)
      res.render('reviews.ejs', {
        msg: { errors: [strings.NLU_NOT_ENOUGH_TEXT] },
      })
    })
})

function checkServiceCredentials() {
  var errors = []
  if (!cloudant || !moviesDb || !naturalLanguageUnderstanding) {
    if (!cloudant || !moviesDb) {
      errors.push(strings.CLOUDANT_PROBLEM)
    }

    if (!naturalLanguageUnderstanding) {
      errors.push(strings.NLU_PROBLEM)
    }
  }
  return errors
}

app.engine('html', require('ejs').renderFile)
app.set('view engine', 'html')
app.use(express.static(__dirname + '/views'))

const port = process.env.PORT || 3004
app.listen(port, function () {
  console.log(`To view your app, open this link in your browser: http://localhost:${port}`)
})

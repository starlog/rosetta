//--------------------------------------------------------------------------------------------------
// test server
//--------------------------------------------------------------------------------------------------
import express from 'express';
import bodyParser from "body-parser";

const app = express();

// parse application/json
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text());

app.all('*', (req, res) => {
  try {
    console.log(`method:${req.method}`);
    console.log(`-----------------------------------------------------------------------`);
    console.log(`url:${req.path}`);
    console.log(`-----------------------------------------------------------------------`);
    console.log('queries');
    for (const element in req.query) {
      console.log(`${element}=${req.query[element]}`);
    }
    console.log(`-----------------------------------------------------------------------`);
    console.log('headers');
    for (const element in req.headers) {
      console.log(`${element}=${req.headers[element]}`);
    }
    console.log(`-----------------------------------------------------------------------`);
    console.log(`body:${JSON.stringify(req.body)}`);
    console.log(`-----------------------------------------------------------------------`);
    res.setHeader('Content-Type', 'application/json');
    // res.status(403).json({message: '403 error'});
    res.send({ message: 'Hello, World!' });
  }catch(ex){
    console.log(`Error: ${ex}`);
  }
})

app.listen(4000, () => {
  console.log('Server running on http://localhost:4000');
});

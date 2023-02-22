/*
RDM Infinity, LLC
Written by: Brandon Robinson
Date: 07/01/22
Unpublished copywrite stuff goes here

Purpose: API server for Multivalue connections and stuff.
Revisions:
*/
/* Get the included stuff here so we can use it later */
//the web server component for routing and the static file handler
const express = require("express");
var serveStatic = require('serve-static')
const bodyParser = require('body-parser');
const url = require('url');
const path = require('path');
//template engine
var pug = require('pug');
//http request handler for pulling in data
const axios = require('axios');
//child processor handling
const { spawn } = require('child_process');
//file pluging to get the config files
const fs = require('fs');

var util = require('util');

/*Set up the Express server to do the heavy lifing for the HTTP stuff*/
var app = express();
app.set('x-powered-by', false);
app.set('x-powered-by', "RDM Infinity rdmBuild Connect - v2.0");
app.use(bodyParser.raw({ inflate: true, type: '*/*' }));
//status monitor
app.use(require('express-status-monitor')({title:"RDM Infinity - Connection Monitor"}));
//get the server.config file
var serverConfig = "";

try{
  serverConfig = require("./configs/server.json");
  console.log(serverConfig);
}
catch(e)
{
  console.log("!!!!!Server config file missing or mis-formatted!!!!!");
  console.error("!!!!!Server not started!!!!!");
  console.log(e);
  process.exit(1);
  return false;
}

/*LEAVE THESE 2 lines alone (or at least in this order) or you can't get the POST body*/
//app.use(express.text());
app.use("/asset",express.static("asset"));
//used for backward compatibility
app.use("/static",express.static("asset"));

// //Setup the middleware to alway get the varString into the rawQuery property
app.use(function(req,res,next){
  if (req.method == "GET")
  {
    req.rawQuery = url.parse(req.url).query;
  }
  else
  {
    req.rawQuery = req.body.toString();
  }
  next();
});
//TODO  - Set port to configuration setting
app.listen(serverConfig.server.serverPort,() =>  {
  console.log("RDM Infinity rdmBuild v2.0 is Running on port "+serverConfig.server.serverPort);
});

//special situation to handle the new debug flags
app.use("/:service/:programName/:format?/:debug?",(req,res,next) => {
  console.log(req.body.toString()); 
  //GET THE SERVICE SETUP FROM THE CONFIGS FOLDER ELSE PANIC
  var service = req.params.service;
  var programName = req.params.programName;
  var serviceConfig = "";
  var serviceLogging = false;
  var serviceLogName = "";
  var outputStarted = false;
  FinalData = "";
  try{
    //serviceConfig = require("./configs/"+service+".json");
    serviceConfig = fs.readFileSync("./configs/"+service+".json");
    serviceConfig = JSON.parse(serviceConfig);
    serviceLogging = serviceConfig.setup.serviceLogging;
    serviceLogName = serviceConfig.setup.serviceLogName;
    //console.log(serviceConfig.toString());
  }catch(e){
    console.log("Cannot find "+service+" config!!!")
    res.status(500);
    res.end("Service Configuration ERROR")
  }
  
  if(serviceLogging)
  {
    console.log(`Service ${service} called and created.`);
  }
  var child = "";
  switch(serviceConfig.setup.dbType)
  {
    case "d3":
      var child = spawn(serviceConfig.setup.dbBinary, 
              ["-n",
              serviceConfig.setup.dbVM,
              "-r",
              "-d",
              "\"\\f"+serviceConfig.setup.dbUser+"\\r"+serviceConfig.setup.dbPassword+"\\r"+req.params.programName.toUpperCase()+"\ "+req.rawQuery+"\\rexit\\r\"",
              "-dcdon",
              "-s"],
              {
                encoding : 'utf8',
                shell: true,
                env: process.env,
                timeout: 10000
            });
    break;
    case "jBase":
      var child = spawn(serviceConfig.setup.dbBinary, 
                  ["-",
                  "-c",
                  '"'+req.params.programName.toUpperCase()+"\ "+req.rawQuery+'"'],{
                encoding : 'utf8',
                shell: true,
                env : serviceConfig.setup.env,
                timeout: 10000
            });  
      break;
      case "uv":
          var child = spawn(serviceConfig.setup.dbBinary, 
              ['"'+req.params.programName.toUpperCase()+"\ "+req.rawQuery+'"'],{
                encoding : 'utf8',
                shell: true,
                env : serviceConfig.setup.env,
                timeout: 10000
            });  
        break;
        case "d3Win":
          //for d3Win use the dbUser as the DB account name
          var child = spawn(serviceConfig.setup.dbBinary, 
            ["-d",
            serviceConfig.setup.dbAccount,
            "-c",
            "\""+req.params.programName.toUpperCase()+"\ "+req.rawQuery+"\"",
            ],
            {
              encoding : 'utf8',
              shell: true,
              env: process.env,
              timeout: 10000,
			        windowsHide:true
          });
          break;
          case "qm":
            //This could be used for ScarletDME also. Set the names of the configs to the correct thing
            var child = spawn(serviceConfig.setup.dbBinary, 
                ["-QUIET",
                "-A"+serviceConfig.setup.dbVM,
                req.params.programName.toUpperCase()+"\ "+req.rawQuery],{
                  encoding : 'utf8',
                  shell: true,
                  env : serviceConfig.setup.env,
                  timeout: 10000
                });  
            break;
          default:
            console.log("We don't suport this type. Try harder next time "+serviceConfig.setup.dbType);
            res.status(500);
            res.write({"error":"DB Type not supported. "+serviceConfig.setup.dbType+" is invalid for config."});
            break;
  }
    if(req.params.format)
    {
      res.type(req.params.format.toString());
    }
    child.stdout.on('data', (data) => {
      // data from the standard output is here as buffers
      //console.log(process.env);
      console.log("On data");
      console.log(outputStarted);
      //console.log(data.toString());
      //FinalData += data.toString().replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
      data = data.toString().replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
      console.log(data);
      //Steve is the magic man that came up with this MUCH smaller version of this. Removed from child.on.close so we can get the chunks of data as they process
      if(!outputStarted)
      {
        //Except this. This was Brandons magic not Steve's
        outputStarted = data.indexOf('~~START~~') > -1 ? true : false;
      }
      console.log(outputStarted);
      
      
      var string = data.indexOf('~~START~~') > -1 ? data.split('~~START~~')[1] : data;
      var output = string.split('~~END~~')[0];
      if(outputStarted)
      {
        res.write(output);
      }
    });
    
    child.on('close', (code) => {
      // console.log(`child process exited with code ${code}`);
      console.log("Closing:");
      console.log(code);
      res.end();
    });
    //strange std out error happened. Panic...
    child.stderr.on('data',(data)=> {
       console.log("stderr hit");
       console.log(data.toString());
    });
    // since these are streams, you can pipe them elsewhere
    //child.stderr.pipe(dest);
    child.on('error',(error)=>{
      console.log(error);
      res.status(500);
      res.write({"error":"Default connection timeout limit. Check server config if needed."});
   });
});

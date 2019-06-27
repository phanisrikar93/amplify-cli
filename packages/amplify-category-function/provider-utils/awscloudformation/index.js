const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');

const categoryName = 'function';

let serviceMetadata;


async function serviceQuestions(context, defaultValuesFilename, serviceWalkthroughFilename) {
  const serviceWalkthroughSrc = `${__dirname}/service-walkthroughs/${serviceWalkthroughFilename}`;
  const { serviceWalkthrough } = require(serviceWalkthroughSrc);

  return serviceWalkthrough(context, defaultValuesFilename, serviceMetadata);
}


function copyCfnTemplate(context, category, options, cfnFilename, writeParams) {
  const { amplify } = context;
  const targetDir = amplify.pathManager.getBackendDirPath();
  const pluginDir = __dirname;
  let force = false;
  let privateParams = false;

  const copyJobs = [{
    dir: pluginDir,
    template: `cloudformation-templates/${cfnFilename}`,
    target: `${targetDir}/${category}/${options.resourceName}/${options.resourceName}-cloudformation-template.json`,
  }];

  if (options.modules) {
    force = true;

    /*
      we treat the parameters from the team provider as private, so we need to update
      the triggerEnvs stringified array only in the options that will be written to the CF
      template parameters
    */
    if (options.triggerEnvs) {
      writeParams = Object.assign({}, writeParams);
      const teamProviderEnvs = context.amplify.loadEnvResourceParameters(context, 'function', options.resourceName);
      options.triggerEnvs = JSON.parse(options.triggerEnvs) || [];
      Object.keys(teamProviderEnvs).forEach((c) => {
        options.triggerEnvs.push({ key: c, value: teamProviderEnvs[c], userInput: true });
      });
      options.triggerEnvs = JSON.stringify(options.triggerEnvs);
      privateParams = true;
    }

    copyJobs.push(...[
      {
        dir: pluginDir,
        template: 'function-template-dir/trigger-index.js',
        target: `${targetDir}/${category}/${options.resourceName}/src/index.js`,
        paramsFile: `${targetDir}/${category}/${options.resourceName}/parameters.json`,
      },
      {
        dir: pluginDir,
        template: 'function-template-dir/event.json',
        target: `${targetDir}/${category}/${options.resourceName}/src/event.json`,
      },
      {
        dir: pluginDir,
        template: 'function-template-dir/package.json.ejs',
        target: `${targetDir}/${category}/${options.resourceName}/src/package.json`,
      },
    ]);
  } else {
    switch (options.functionTemplate) {
      case 'helloWorld':
        copyJobs.push(...[
          {
            dir: pluginDir,
            template: 'function-template-dir/index.js.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/index.js`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/event.json',
            target: `${targetDir}/${category}/${options.resourceName}/src/event.json`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/package.json.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/package.json`,
          },
        ]);
        break;
      case 'serverless':
        copyJobs.push(...[
          {
            dir: pluginDir,
            template: 'function-template-dir/serverless-index.js',
            target: `${targetDir}/${category}/${options.resourceName}/src/index.js`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/serverless-app.js.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/app.js`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/serverless-package.json.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/package.json`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/serverless-event.json',
            target: `${targetDir}/${category}/${options.resourceName}/src/event.json`,
          },
        ]);
        break;
      default:
        copyJobs.push(...[
          {
            dir: pluginDir,
            template: 'function-template-dir/crud-index.js',
            target: `${targetDir}/${category}/${options.resourceName}/src/index.js`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/crud-app.js.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/app.js`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/crud-package.json.ejs',
            target: `${targetDir}/${category}/${options.resourceName}/src/package.json`,
          },
          {
            dir: pluginDir,
            template: 'function-template-dir/crud-event.json',
            target: `${targetDir}/${category}/${options.resourceName}/src/event.json`,
          },
        ]);
        break;
    }
  }
  // copy over the files
  return context.amplify.copyBatch(context, copyJobs, options, force, writeParams, privateParams);
}

function createParametersFile(context, parameters, resourceName) {
  const parametersFileName = 'function-parameters.json';
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const resourceDirPath = path.join(projectBackendDirPath, categoryName, resourceName);
  fs.ensureDirSync(resourceDirPath);
  const parametersFilePath = path.join(resourceDirPath, parametersFileName);
  const jsonString = JSON.stringify(parameters, null, 4);
  fs.writeFileSync(parametersFilePath, jsonString, 'utf8');
}

async function addResource(context, category, service, options, parameters) {
  let answers;
  serviceMetadata = context.amplify.readJsonFile(`${__dirname}/../supported-services.json`)[service];
  const { cfnFilename, defaultValuesFilename, serviceWalkthroughFilename } = serviceMetadata;
  let result;

  if (!parameters) {
    result = await serviceQuestions(context, defaultValuesFilename, serviceWalkthroughFilename);
  } else {
    result = { answers: parameters };
  }

  if (result.answers) {
    ({ answers } = result);
    options.dependsOn = result.dependsOn;
  } else {
    answers = result;
  }

  context.amplify.updateamplifyMetaAfterResourceAdd(
    category,
    answers.resourceName,
    options,
  );

  copyCfnTemplate(context, category, answers, cfnFilename, parameters);
  if (answers.parameters) {
    createParametersFile(context, answers.parameters, answers.resourceName);
  }

  await openEditor(context, category, answers);

  return answers.resourceName;
}

async function updateResource(context, category, service, parameters, resourceToUpdate, skipEdit) {
  let answers;
  serviceMetadata = context.amplify.readJsonFile(`${__dirname}/../supported-services.json`)[service];
  const { cfnFilename, serviceWalkthroughFilename } = serviceMetadata;

  const serviceWalkthroughSrc = `${__dirname}/service-walkthroughs/${serviceWalkthroughFilename}`;
  const { updateWalkthrough } = require(serviceWalkthroughSrc);

  let result;

  if (!parameters) {
    result = await updateWalkthrough(context, resourceToUpdate);
  } else {
    result = { answers: parameters };
  }


  if (result.answers) {
    ({ answers } = result);
  } else {
    answers = result;
  }

  if (result.dependsOn) {
    context.amplify.updateamplifyMetaAfterResourceUpdate(
      category,
      answers.resourceName,
      'dependsOn',
      result.dependsOn,
    );
  }

  const previousParameters = context.amplify.readJsonFile(`${context.amplify.pathManager.getBackendDirPath()}/function/${resourceToUpdate}/parameters.json`);

  if (previousParameters.modules) {
    answers = Object.assign(answers, previousParameters);
  }

  copyCfnTemplate(context, category, answers, cfnFilename, parameters);

  if (!skipEdit) {
    await openEditor(context, category, answers);
  }

  return answers.resourceName;
}

async function openEditor(context, category, options) {
  let displayName;
  if (options.modules) {
    try {
      displayName = options.resourceName.substring(options.parentResource.length);
    } catch (e) {
      displayName = '';
    }
  }
  const targetDir = context.amplify.pathManager.getBackendDirPath();
  if (!options.modules) {
    if (await context.amplify.confirmPrompt.run('Do you want to edit the local lambda function now?')) {
      switch (options.functionTemplate) {
        case 'helloWorld':
          await context.amplify.openEditor(context, `${targetDir}/${category}/${options.resourceName}/src/index.js`);
          break;
        case 'serverless':
          await context.amplify.openEditor(context, `${targetDir}/${category}/${options.resourceName}/src/app.js`);
          break;
        default:
          await context.amplify.openEditor(context, `${targetDir}/${category}/${options.resourceName}/src/app.js`);
          break;
      }
    }
  } else if (await context.amplify.confirmPrompt.run(`Do you want to edit the local ${displayName} lambda function now?`)) {
    await context.amplify.openEditor(context, `${targetDir}/${category}/${options.resourceName}/src/index.js`);
  }
}

async function invoke(context, category, service, resourceName) {
  const { amplify } = context;
  serviceMetadata = amplify.readJsonFile(`${__dirname}/../supported-services.json`)[service];
  const { inputs } = serviceMetadata;
  const resourceQuestions = [
    {
      type: inputs[2].type,
      name: inputs[2].key,
      message: inputs[2].question,
      validate: amplify.inputValidation(inputs[2]),
      default: 'index.js',
    },
    {
      type: inputs[3].type,
      name: inputs[3].key,
      message: inputs[3].question,
      validate: amplify.inputValidation(inputs[3]),
      default: 'handler',
    },
  ];

  // Ask handler and function file name questions

  const resourceAnswers = await inquirer.prompt(resourceQuestions);


  // Run grunt for invoking lambda function

  const grunt = require('grunt');
  grunt.task.init = function () { }; //eslint-disable-line
  const backEndDir = context.amplify.pathManager.getBackendDirPath();
  const srcDir = path.normalize(path.join(backEndDir, category, resourceName, 'src'));

  grunt.initConfig({
    lambda_invoke: {
      default: {
        options: {
          file_name: `${srcDir}/${resourceAnswers[inputs[2].key]}`,
          handler: `${resourceAnswers[inputs[3].key]}`,
          event: `${srcDir}/event.json`,
        },
      },
    },
  });
  // For prod builds since dependencies are hoisted
  if (!fs.existsSync(`${__dirname}/../../node_modules/grunt-aws-lambda`)) {
    process.chdir(`${__dirname}/../../../../`); // grunt checks for node_mnodules in this dir
  } else {
    // For dev builds
    process.chdir(`${__dirname}/../../`); // grunt checks for node_mnodules in this dir
  }

  grunt.loadNpmTasks('grunt-aws-lambda');

  grunt.tasks(['lambda_invoke'], {}, () => {
    console.log('Done running invoke function.');
  });
}

function migrateResource(context, projectPath, service, resourceName) {
  serviceMetadata = context.amplify.readJsonFile(`${__dirname}/../supported-services.json`)[service];
  const { serviceWalkthroughFilename } = serviceMetadata;
  const serviceWalkthroughSrc = `${__dirname}/service-walkthroughs/${serviceWalkthroughFilename}`;
  const { migrate } = require(serviceWalkthroughSrc);

  if (!migrate) {
    context.print.info(`No migration required for ${resourceName}`);
    return;
  }

  return migrate(context, projectPath, resourceName);
}

function getPermissionPolicies(context, service, resourceName, crudOptions) {
  serviceMetadata = context.amplify.readJsonFile(`${__dirname}/../supported-services.json`)[service];
  const { serviceWalkthroughFilename } = serviceMetadata;
  const serviceWalkthroughSrc = `${__dirname}/service-walkthroughs/${serviceWalkthroughFilename}`;
  const { getIAMPolicies } = require(serviceWalkthroughSrc);

  if (!getPermissionPolicies) {
    context.print.info(`No policies found for ${resourceName}`);
    return;
  }

  return getIAMPolicies(resourceName, crudOptions);
}

function isInHeadlessMode(context) {
  return context.exeInfo.inputParams.yes;
}

function getHeadlessParams(context, service) {
  const { inputParams } = context.exeInfo;
  return inputParams.categories.function.find(i => i.resourceName === service) || {};
}


async function updateConfigOnEnvInit(context, category, service) {
  const srvcMetaData = context.amplify.readJsonFile(`${__dirname}/../supported-services.json`)
    .Lambda;
  const providerPlugin = context.amplify.getPluginInstance(context, srvcMetaData.provider);
  const resourceParams = providerPlugin.loadResourceParameters(context, 'function', service);
  let envParams = {};

  // headless mode
  if (isInHeadlessMode(context)) {
    const functionParams = getHeadlessParams(context, service);
    return functionParams;
  }

  if (resourceParams.modules && resourceParams.modules.length > 0) {
    envParams = await initTriggerEnvs(
      context,
      resourceParams,
      providerPlugin,
      envParams,
      srvcMetaData,
    );
  }
  return envParams;
}

async function initTriggerEnvs(context, resourceParams, providerPlugin, envParams, srvcMetaData) {
  if (resourceParams && resourceParams.parentStack && resourceParams.parentResource) {
    const parentResourceParams = providerPlugin
      .loadResourceParameters(context, resourceParams.parentStack, resourceParams.parentResource);
    const triggers = typeof parentResourceParams.triggers === 'string' ? JSON.parse(parentResourceParams.triggers) : parentResourceParams.triggers;
    const parentKeys = Object.keys(parentResourceParams);
    const parentValues = Object.values(parentResourceParams);
    const index = parentValues.indexOf(resourceParams.resourceName);
    const currentTrigger = parentKeys[index];
    const currentEnvVariables = context.amplify.loadEnvResourceParameters(context, 'function', resourceParams.resourceName);
    const triggerPath = `${__dirname}/../../../amplify-category-${resourceParams.parentStack}/provider-utils/${srvcMetaData.provider}/triggers/${currentTrigger}`;
    if (context.commandName !== 'checkout') {
      envParams = await context.amplify.getTriggerEnvInputs(
        context,
        triggerPath,
        currentTrigger,
        triggers[currentTrigger],
        currentEnvVariables[currentTrigger],
      );
    } else {
      envParams = currentEnvVariables;
    }
  }
  return envParams;
}


module.exports = {
  addResource,
  updateResource,
  invoke,
  migrateResource,
  getPermissionPolicies,
  updateConfigOnEnvInit,
};

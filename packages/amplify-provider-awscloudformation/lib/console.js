const opn = require('opn'); 
const constants = require('./constants'); 

function run(context){
    const metaData = context.amplify.getProjectMeta(); 
    let consoleUrl = 'https://console.aws.amazon.com/cloudformation/';
    if(metaData.providers && metaData.providers[constants.Label]){
        const {Region, StackId} = metaData.providers[constants.Label]; 
        consoleUrl = `https://console.aws.amazon.com/cloudformation/home?region=${Region}#/stack/detail?stackId=${StackId}`; 
    }
    opn(consoleUrl, { wait: false });
}

module.exports = {
    run
}
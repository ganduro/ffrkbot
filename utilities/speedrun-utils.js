const {google} = require('googleapis');
const util = require('util');
const fs = require('fs');
const OAuth2Client = google.auth.OAuth2;
fs.readFileAsync = util.promisify(fs.readFile);
const titlecase = require('titlecase');
const escapeStringRegexp = require('escape-string-regexp');
const pad = require('pad');

const SPREADSHEET_ID = '11gTjAkpm4D3uoxnYCN7ZfbiVnKyi7tmm9Vp9HvTkGpw';
const TOKEN_PATH = 'secrets/credentials.json';
const SECRETS_PATH = 'secrets/client_secret.json';

/** authorize():
 * Authorizes Google credentials.
 * @return {google.auth.OAuth2} oAuth2Client
 **/
async function authorize() {
  let secrets;
  let token;
  try {
    secrets = await fs.readFileAsync(SECRETS_PATH);
    token = await fs.readFileAsync(TOKEN_PATH);
    const credentials = JSON.parse(secrets);
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new OAuth2Client(
      client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    console.log('Unable to open SECRETS_PATH or TOKEN_PATH', err);
  }
}

exports.speedrun = function lookupSpeedrun(
  msg, rows, category, secondaryCategory) {
  return new Promise((resolve, reject) => {
    const sheets = google.sheets({version: 'v4'});
    authorize()
      .then((oAuth2Client) => {
        category = escapeStringRegexp(category);
        category = category.toLowerCase();
        const categorySheet = getSheet(category);
        secondaryCategory = titlecase.toLaxTitleCase(secondaryCategory);
        const request = {
          spreadsheetId: SPREADSHEET_ID,
          range: categorySheet,
          auth: oAuth2Client,
        };
        sheets.spreadsheets.values.get(request, (err, {data}) => {
          if (err) {
            if (err.code === 400) {
              console.log(err.message);
              msg.channel.send(`Invalid speedrun category "${category}".`)
                .then((res) => {
                  resolve(res);
                  return;
                });
            } else {
              console.log(err);
              msg.channel.send(
                'The bot user has not set up valid Google API credentials yet.')
              .then((res) => {
                resolve(res);
                return;
              });
            }
          } else {
            // Find where the secondaryCategory is on the sheet in question
            console.log(data);
            const categoryRange = find(secondaryCategory, data.values);
            let categoryNames = [];
            // Get the row where the categories lie.
            const categoryRow = data.values[categoryRange.row + 1];
            // Start from the place where secondaryCategory was found,
            // Add 2 to categoryRow because the category rows are always going
            // to be 2 below the secondary category,
            // push secondaryCategory into cagetoryNames,
            // increment the place where secondaryCategory was found by one,
            // and keep going until we either hit a '' or undefined.
            for
            (let i = categoryRange.columnNum - 1; i < categoryRow.length; i++) {
              console.log(i);
              if (categoryRow[i] === undefined ||
                  categoryRow[i] === '' ||
                  categoryRow[i] === null) {
                break;
              }
              console.log(categoryRow[i]);
              categoryNames.push(categoryRow[i]);
            }
            // Now that we know the category names, we need to get the values of
            // the top {rows} contestants.
            // The contestants will always be in the row right below the
            // category
            let contestants = [];
            let padLength = 0;
            for (let i = 0; i < rows; i++) {
              // categoryRange.row + 2 will give us the starting row of
              // contestants.
              let row = categoryRange.row + 2 + i;
              let contestant = [];
              for (let j = 1;
                   j <= categoryNames.length; j++) {
                     // j is initially 1 because we don't care about getting
                     // the rank.
                     if (data.values[row][j].length > padLength) {
                       // Pad the contestant name table with the longest
                       // contestant name (and add an extra 1 for spacing.)
                       padLength = data.values[row][j].length + 1;
                     }
                     contestant.push(data.values[row][j]);
                   }
              contestants.push(contestant);
            }
            const rankTable =
              outputRankTable(categorySheet, rows, secondaryCategory,
                categoryNames, contestants, padLength);
            msg.channel.send(rankTable)
              .then( (res) => {
                resolve(res);
            });
          }
        });
      });
  });
};

/** getSheet():
 *  returns a sheet based on the shorthand input the user provides.
 * @param {String} category: the category the user inputs.
 * @return {String} sheet
 **/
function getSheet(category) {
  switch (category) {
    case 'overall':
      category = 'GL 4* Overall rankings';
      break;
    case 'no-csb':
      category = 'GL 4* No CSB rankings';
      break;
    case 'cod':
      category = 'GL CoD Speedrun rankings';
      break;
    case 'magicite':
      category = '4* Magicite';
      break;
    default:
      category = titlecase.toLaxTitleCase(category);
    }
  return category;
}
 /**
 * Finds a value within a given range.
 * @see https://stackoverflow.com/questions/10807936/how-do-i-search-google-spreadsheets/10823543#10823543
 * @param {String} value The value to find.
 * @param {String} data The range to search in using Google's A1 format.
 * @return {Object} A range pointing to the first cell containing the value,
 *     or null if not found.
 */
function find(value, data) {
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data[i].length; j++) {
      if (data[i][j] == value) {
        const columnName = columnToName(j + 1);
        return {row: i + 1, column: columnName, columnNum: j + 1};
      }
    }
  }
  return null;
}
/**
 * Returns the Google Spreadsheet column name equivalent of a number.
 * @param {Integer} columnNumber The column number to look for
 * @return {String} columnName
 */
function columnToName(columnNumber) {
  let columnName = '';
  let modulo;
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  while (columnNumber > 0) {
    modulo = (columnNumber - 1) % 26;
    columnName = alpha.charAt(modulo) + columnName;
    columnNumber = Math.floor((columnNumber - modulo)/26);
  }
  return columnName;
}

/**
  * Formats a ranking table for output.
  * @param {String} category
  * @param {Integer} rows
  * @param {String} secondaryCategory
  * @param {Array} categoryNames
  * @param {Array} contestants
  * @param {Integer} namePadLength
  * @return {String} table
  */
function outputRankTable(category, rows, secondaryCategory,
  categoryNames, contestants, namePadLength) {
  let table = '';
  table += outputTitle(category, rows, secondaryCategory);
  table += outputCategoryHeader(categoryNames, namePadLength);
  table += outputContestants(contestants, namePadLength);
  table = util.format('```%s```', table);
  return table;
}
/**
  * Outputs the title of the table.
  * @param {String} category
  * @param {Integer} rows
  * @param {String} secondaryCategory
  * @return {String} title
  */
function outputTitle(category, rows, secondaryCategory) {
  console.log(category, rows, secondaryCategory);
  let title = '';
  if (category === 'GL 4* Overall rankings' ||
      category === 'GL 4* No CSB rankings') {
        title = `Top ${rows} ${category}\n`;
  } else {
    title = `Top ${rows} ${category} (${secondaryCategory})\n`;
  }
  return title;
}
/**
  * Outputs category headers for table.
  * @param {Array} categoryNames
  * @param {Integer} namePadLength
  * @return {String} categoryHeader
  */
function outputCategoryHeader(categoryNames, namePadLength) {
  let categoryHeader = '';
  categoryHeader += 'Rank | ';
  categoryHeader += pad(categoryNames[0], namePadLength);
  categoryHeader += ' | ';
  for (let i = 1; i < categoryNames.length; i++) {
    categoryHeader += pad(categoryNames[i], 9);
    categoryHeader += ' | ';
  }
  const repeatLength = categoryHeader.length - 1;
  categoryHeader += '\n';
  // create a series of dashes to indicate header
  categoryHeader += '-'.repeat(repeatLength);
  categoryHeader += '\n';
  return categoryHeader;
}
/**
  * Outputs contestants.
  * @param {Array} contestants
  * @param {Integer} namePadLength
  * @return {String} formattedContestants
  */
function outputContestants(contestants, namePadLength) {
  let formattedContestants = '';
  for (let i = 0; i < contestants.length; i++) {
    formattedContestants += pad(4, i + 1);
    formattedContestants += ' | ';
    formattedContestants += pad(contestants[i][0], namePadLength);
    formattedContestants += ' | ';
    for (let j = 1; j < contestants[i].length; j++) {
      formattedContestants += pad(contestants[i][j], 9);
      formattedContestants += ' | ';
    }
    formattedContestants += '\n';
  }
  return formattedContestants;
}
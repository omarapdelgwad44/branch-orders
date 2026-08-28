/**
 * Spreadsheet-bound menu helpers. Open the spreadsheet → the "Branch Orders"
 * menu lets you run setup, create the first admin, and load demo data
 * without opening the script editor.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Branch Orders')
    .addItem('Run system setup', 'menuSetup')
    .addItem('Create first admin', 'menuFirstAdmin')
    .addItem('Load demo data', 'menuDemo')
    .addSeparator()
    .addItem('Open documentation', 'menuDocs')
    .addToUi();
}

function menuSetup() {
  try {
    var r = setupSystem();
    SpreadsheetApp.getUi().alert('Setup complete.\nSheets: ' + r.sheets.join(', '));
  } catch (err) {
    SpreadsheetApp.getUi().alert('Setup failed: ' + (err.message || err));
  }
}

function menuFirstAdmin() {
  var ui = SpreadsheetApp.getUi();
  var user = ui.prompt('Create first admin', 'Username:', ui.ButtonSet.OK_CANCEL);
  if (user.getSelectedButton() !== ui.Button.OK) return;
  var pwd = ui.prompt('Create first admin', 'Password (min 6 chars):', ui.ButtonSet.OK_CANCEL);
  if (pwd.getSelectedButton() !== ui.Button.OK) return;
  try {
    var r = createFirstAdmin(user.getResponseText(), pwd.getResponseText());
    ui.alert('Admin created: ' + r.username);
  } catch (err) {
    ui.alert('Failed: ' + (err.message || err));
  }
}

function menuDemo() {
  try {
    loadDemoData();
    SpreadsheetApp.getUi().alert('Demo data loaded. Admin: admin.demo / Demo@1234. Branch: ali.ahmed / Demo@1234.');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Failed: ' + (err.message || err));
  }
}

function menuDocs() {
  SpreadsheetApp.getUi().alert('See the project README for full documentation, deployment steps, and security notes.');
}
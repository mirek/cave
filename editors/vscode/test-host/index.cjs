const assert = require('node:assert/strict')
const fs = require('node:fs')
const vscode = require('vscode')
exports.run = async () => {
  const extension = vscode.extensions.getExtension('MirekRusin.cave-language')
  assert.ok(extension, 'CAVE extension is available')
  const directory = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'cave-editor-host-'))
  try {
    const filename = require('node:path').join(directory, 'smoke.cave')
    fs.writeFileSync(filename, 'api HAS message: "café 😀"\r\nrevenue IS 20B -> 40B USD/yr\r\napi IS service @ 85%')
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename))
    assert.equal(document.languageId, 'cave', 'the packaged file association selects CAVE')
    const editor = await vscode.window.showTextDocument(document)
    assert.equal(editor.options.insertSpaces, true)
    assert.equal(editor.options.tabSize, 2)
    const activationDeadline = Date.now() + 10000
    while (!extension.isActive) {
      assert.ok(Date.now() < activationDeadline, 'opening a CAVE file activates the extension within 10 seconds')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', document.uri)
    assert.ok(legend?.tokenTypes.includes('keyword'))
    assert.equal(extension.isActive, true, 'opening a CAVE file activates the extension')
    const readTokens = async () => {
      const tokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', document.uri)
      assert.ok(tokens?.data.length > 0)
      assert.equal(tokens.data.length % 5, 0)
      let line = 0, character = 0
      const decoded = []
      for (let i = 0; i < tokens.data.length; i += 5) {
        const [deltaLine, deltaStart, length, type] = tokens.data.slice(i, i + 5)
        line += deltaLine
        character = deltaLine === 0 ? character + deltaStart : deltaStart
        assert.ok(length > 0 && character + length <= document.lineAt(line).text.length)
        assert.ok(legend.tokenTypes[type])
        const previous = decoded.at(-1)
        assert.ok(!previous || previous.line < line || previous.character + previous.length <= character, 'tokens do not overlap')
        decoded.push({ line, character, length, type: legend.tokenTypes[type], text: document.lineAt(line).text.slice(character, character + length) })
      }
      return decoded
    }
    const decoded = await readTokens()
    assert.ok(decoded.some(token=>token.type==='operator' && token.text==='->'))
    assert.ok(decoded.some(token=>token.type==='keyword' && token.text==='HAS'))
    assert.ok(decoded.some(token => token.type === 'string' && token.text === '"café 😀"'))
    const edits = []
    for (const content of ['𐐀pi HAS label: "unfinished\r\nnext IS service', '𐐀pi HAS label: "🚀 database"\r\nnext IS service']) {
      const previousVersion = document.version
      assert.equal(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content)), true)
      assert.ok(document.version > previousVersion)
      const tokens = await readTokens()
      assert.ok(tokens.some(token => token.line === 1 && token.type === 'keyword' && token.text === 'IS'))
      assert.ok(tokens.some(token => token.type === 'variable' && token.text === '𐐀pi' && token.length === 4))
      assert.ok(!tokens.some(token => token.text === 'revenue'), 'tokens reflect the edited document')
      edits.push({ documentVersion: document.version, tokens })
    }
    assert.ok(edits.at(-1).tokens.some(token => token.type === 'string' && token.text === '"🚀 database"'))
    const result = JSON.stringify({version:vscode.version,active:extension.isActive,languageId:document.languageId,insertSpaces:editor.options.insertSpaces,tabSize:editor.options.tabSize,decoded,edits},null,2)
    if (process.env.CAVE_VSCODE_HOST_RESULT) fs.writeFileSync(process.env.CAVE_VSCODE_HOST_RESULT, result)
    else console.log(result)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

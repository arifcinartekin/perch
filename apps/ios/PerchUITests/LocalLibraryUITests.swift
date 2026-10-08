import XCTest

/// Reading without a server: a fresh library on the phone, add a feed by a
/// site's address (the app finds and fetches the feed itself), open an
/// article. Needs the internet and a site to add, passed with the
/// TEST_RUNNER_ prefix:
///
///     TEST_RUNNER_PERCH_UI_SITE=daringfireball.net xcodebuild test -scheme Perch …
///
/// Set TEST_RUNNER_PERCH_SHOTS to a folder to also save screenshots there.
@MainActor
final class LocalLibraryUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_UI_SITE"] == nil, "No site to add configured")
  }

  private func shot(_ name: String) {
    let png = XCUIScreen.main.screenshot().pngRepresentation
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let dir = env["PERCH_SHOTS"] {
      try? png.write(to: URL(filePath: dir).appending(path: "\(name).png"))
    }
  }

  func testAddAFeedAndRead() throws {
    let app = XCUIApplication()
    app.launchEnvironment["PERCH_DEV_LOCAL"] = "fresh"
    app.launch()

    // No server to choose: the app opens on an empty library.
    let add = app.buttons["Add a feed"]
    XCTAssertTrue(add.waitForExistence(timeout: 10))
    shot("local-empty")
    add.tap()

    let field = app.textFields["Site or feed address"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.typeText(env["PERCH_UI_SITE"]!)
    shot("local-add")
    app.buttons["Add"].tap()

    // The sheet closes and the new feed's articles are listed.
    let closed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: field)
    wait(for: [closed], timeout: 40)
    let firstRow = app.collectionViews.firstMatch.cells.firstMatch
    XCTAssertTrue(firstRow.waitForExistence(timeout: 10))
    sleep(2)
    shot("local-feed")

    firstRow.tap()
    XCTAssertTrue(app.buttons["Next article"].waitForExistence(timeout: 10))
    sleep(2)
    shot("local-article")

    // Settings offers a server instead of requiring one.
    app.navigationBars.buttons.firstMatch.tap()
    app.tabBars.buttons["Settings"].tap()
    XCTAssertTrue(app.buttons["Connect to a Perch Server…"].waitForExistence(timeout: 5))
    shot("local-settings")
  }
}

import XCTest

/// Picking colours one after another keeps all of them: a reply to an
/// earlier save (or the server's change event) mustn't undo a later pick.
/// Runs against a server like ReaderUITests; check the account's settings
/// afterwards.
@MainActor
final class AppearanceUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_DEV_SERVER"] == nil, "No test server configured")
  }

  func testQuickColourPicksStick() throws {
    let app = XCUIApplication()
    for key in ["PERCH_DEV_SERVER", "PERCH_DEV_USER", "PERCH_DEV_PASSWORD"] {
      app.launchEnvironment[key] = env[key]
    }
    app.launchEnvironment["PERCH_DEV_TAB"] = "settings"
    app.launchEnvironment["PERCH_DEV_PAGE"] = "appearance"
    app.launch()

    // Accent and Buttons both offer the same swatches.
    let blue = app.buttons.matching(identifier: "#3b82f6")
    XCTAssertTrue(blue.firstMatch.waitForExistence(timeout: 15))
    let reset = app.buttons["Reset light theme colors"]
    if reset.exists {
      reset.tap()
      sleep(2)
    }

    blue.element(boundBy: 0).tap()
    // Long enough for the first save (and its change event) to be on the way.
    usleep(700_000)
    app.swipeUp()
    blue.element(boundBy: 1).tap()
    sleep(4)

    XCTAssertTrue(app.buttons["Reset light theme colors"].exists)
    if let dir = env["PERCH_SHOTS"] {
      try? XCUIScreen.main.screenshot().pngRepresentation.write(
        to: URL(filePath: dir).appending(path: "appearance-picks.png"))
    }
  }
}

import XCTest

/// Joining a sync chain from its QR code: the Camera opens a perch://chain
/// link, the app offers to join, the chain's library arrives, and a star
/// made here goes back out. Needs a relay with a chain already holding a
/// feed, passed with the TEST_RUNNER_ prefix:
///
///     TEST_RUNNER_PERCH_UI_CHAIN='perch://chain?server=…&code=…' \
///     TEST_RUNNER_PERCH_UI_CHAIN_FEED='Daring Fireball' xcodebuild test -scheme Perch …
///
/// Set TEST_RUNNER_PERCH_SHOTS to a folder to also save screenshots there.
@MainActor
final class ChainUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_UI_CHAIN"] == nil, "No chain to join configured")
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

  func testJoinFromQRCodeAndSync() throws {
    let app = XCUIApplication()
    app.launchEnvironment["PERCH_DEV_LOCAL"] = "fresh"
    app.launch()
    XCTAssertTrue(app.buttons["Add a feed"].waitForExistence(timeout: 10))

    // What scanning the QR code with the Camera does.
    app.open(URL(string: env["PERCH_UI_CHAIN"]!)!)
    let join = app.buttons["Join"]
    XCTAssertTrue(join.waitForExistence(timeout: 10))
    shot("chain-join")
    join.tap()
    XCTAssertTrue(
      expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: join).wait(40))

    // The chain's feed is here, fetched by the phone, in the chain's category.
    app.tabBars.buttons["Feeds"].tap()
    let feed = app.staticTexts[env["PERCH_UI_CHAIN_FEED"] ?? "Daring Fireball"]
    XCTAssertTrue(feed.waitForExistence(timeout: 40))
    sleep(2)
    shot("chain-feeds")

    // Star the newest article; the change goes out a moment later.
    app.tabBars.buttons["Unread"].tap()
    let row = app.collectionViews.firstMatch.cells.firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 40))
    row.tap()
    let star = app.buttons["Star"]
    XCTAssertTrue(star.waitForExistence(timeout: 10))
    star.tap()
    XCTAssertTrue(app.buttons["Unstar"].waitForExistence(timeout: 5))
    sleep(4)

    // Settings shows the chain and the code for adding a device.
    app.navigationBars.buttons.firstMatch.tap()
    app.tabBars.buttons["Settings"].tap()
    let chainRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync chain'"))
      .firstMatch
    XCTAssertTrue(chainRow.waitForExistence(timeout: 5))
    chainRow.tap()
    XCTAssertTrue(app.buttons["Sync now"].waitForExistence(timeout: 5))
    app.buttons["Add a device"].tap()
    XCTAssertTrue(app.buttons["Copy code"].waitForExistence(timeout: 5))
    sleep(1)
    shot("chain-settings")
  }
}

extension XCTestExpectation {
  /// Waits on this one expectation; true when it was met in time.
  @MainActor fileprivate func wait(_ seconds: TimeInterval) -> Bool {
    XCTWaiter().wait(for: [self], timeout: seconds) == .completed
  }
}

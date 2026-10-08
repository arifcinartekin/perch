import XCTest

/// Walks through reading against a running Perch Server. Needs the same
/// variables as the app's debug sign-in, passed with the TEST_RUNNER_ prefix:
///
///     TEST_RUNNER_PERCH_DEV_SERVER=http://localhost:8791 \
///     TEST_RUNNER_PERCH_DEV_USER=… TEST_RUNNER_PERCH_DEV_PASSWORD=… \
///     xcodebuild test -scheme Perch -destination …
///
/// Set TEST_RUNNER_PERCH_SHOTS to a folder to also save screenshots there.
@MainActor
final class ReaderUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_DEV_SERVER"] == nil, "No test server configured")
  }

  private func launch(_ extra: [String: String] = [:]) -> XCUIApplication {
    let app = XCUIApplication()
    for key in ["PERCH_DEV_SERVER", "PERCH_DEV_USER", "PERCH_DEV_PASSWORD"] {
      app.launchEnvironment[key] = env[key]
    }
    app.launchEnvironment.merge(extra) { $1 }
    app.launch()
    return app
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

  private func drag(_ element: XCUIElement, from: Double, to: Double) {
    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
      .press(
        forDuration: 0.05,
        thenDragTo: element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)),
        withVelocity: .slow, thenHoldForDuration: 0.1)
  }

  func testReading() throws {
    let app = launch(["PERCH_DEV_TAB": "feeds", "PERCH_DEV_OPEN": env["PERCH_UI_FEED"] ?? "all"])
    // On iPad the feeds sidebar comes first, then the article list.
    let lists = app.collectionViews
    let isPad = UIDevice.current.userInterfaceIdiom == .pad
    let firstRow = (isPad ? lists.element(boundBy: 1) : lists.firstMatch).cells.firstMatch
    XCTAssertTrue(firstRow.waitForExistence(timeout: 20))
    shot("list")
    firstRow.tap()

    let star = app.buttons["Star"].firstMatch
    XCTAssertTrue(star.waitForExistence(timeout: 10))
    sleep(2)
    shot("reader")

    // Scrolling into the article hides the bars; scrolling back brings them.
    // On iPhone, scrolling into the article hides the bars and scrolling
    // back brings them; short drags, so even a short article doesn't reach
    // its end (where the bars come back too). On iPad they stay.
    let page = app.webViews.firstMatch
    drag(page, from: 0.7, to: 0.55)
    sleep(1)
    shot("reader-scrolled")
    XCTAssertEqual(star.isHittable, isPad, "bars hide while reading down on iPhone only")
    drag(page, from: 0.5, to: 0.6)
    sleep(1)
    XCTAssertTrue(star.isHittable, "bars should come back on scrolling up")

    app.buttons["Text"].tap()
    let larger = app.buttons["Larger"]
    XCTAssertTrue(larger.waitForExistence(timeout: 5))
    larger.tap()
    larger.tap()
    sleep(1)
    shot("text-settings")
    app.buttons["Smaller"].tap()
    app.buttons["Smaller"].tap()
    // Tap above the sheet to close it.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
    XCTAssertTrue(larger.waitForNonExistence(timeout: 5))

    app.buttons["Next article"].tap()
    sleep(2)
    shot("next")
    XCTAssertTrue(star.isHittable)
  }
}

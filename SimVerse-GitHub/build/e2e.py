"""End-to-end smoke test for SimVerse using a real Chromium browser."""
import asyncio
import json
import re
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8791"
SHOT = "/home/user/simverse/_shots"

failures = []
def check(cond, label, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + ((" :: " + str(extra)) if extra and not cond else ""))
    if not cond:
        failures.append(label + (" :: " + str(extra) if extra else ""))


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 950})

        errors = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console.error: " + m.text) if m.type == "error" else None)

        # ------------------------------------------------------------- home
        await page.goto(BASE + "/#/", wait_until="load")
        await page.wait_for_timeout(700)
        print("\n[HOME]")
        check("SimVerse" in await page.title(), "title contains SimVerse", await page.title())
        check(await page.locator(".h1").count() > 0, "hero h1 rendered")
        check(await page.locator(".class-card").count() == 4, "4 class cards",
              await page.locator(".class-card").count())
        stats = await page.locator(".stat b").all_inner_texts()
        print("        hero stats:", stats)
        check(stats and stats[0].replace(",", "").isdigit() and int(stats[0].replace(",", "")) > 1000,
              "sim count stat > 1000", stats)
        check(await page.locator("#homeQuote").inner_text() != "", "home quote rendered")

        # rotate quote
        q1 = await page.locator("#homeQuote").inner_text()
        await page.click("[data-next-quote]")
        await page.wait_for_timeout(320)
        q2 = await page.locator("#homeQuote").inner_text()
        check(q1 != q2, "quote rotates", (q1[:30], q2[:30]))

        await page.screenshot(path=f"{SHOT}/01-home.png", full_page=True)

        # -------------------------------------------------------- class page
        print("\n[CLASS 10]")
        await page.click('a[href="#/class/10"]')
        await page.wait_for_timeout(500)
        check(await page.locator(".subject-card").count() == 4, "4 subject cards",
              await page.locator(".subject-card").count())
        check(await page.locator(".bar i").count() >= 4, "coverage bars present")
        await page.screenshot(path=f"{SHOT}/02-class10.png", full_page=True)

        # ------------------------------------------------------ subject page
        print("\n[CLASS 10 / PHYSICS]")
        await page.click('a[href="#/class/10/physics"]')
        await page.wait_for_timeout(500)
        n_chap = await page.locator(".chap-card").count()
        check(n_chap == 5, "physics class-10 has 5 chapters", n_chap)
        await page.screenshot(path=f"{SHOT}/03-class10-physics.png", full_page=True)

        # ------------------------------------------------------ chapter page
        print("\n[CLASS 10 / PHYSICS / CH0 = Light]")
        await page.click('a[href="#/class/10/physics/0"]')
        await page.wait_for_timeout(500)
        heads = await page.locator(".h2").first.inner_text()
        check("Light" in heads, "chapter heading is Light", heads)
        n_topic = await page.locator(".topic").count()
        n_sim = await page.locator("a.sim").count()
        n_soon = await page.locator(".soon").count()
        print(f"        topics={n_topic} sim links={n_sim} coming-soon={n_soon}")
        check(n_topic > 0, "topics rendered", n_topic)
        check(n_sim > 0, "sim links rendered", n_sim)
        check(n_soon > 0, "coming-soon blocks rendered", n_soon)
        check(await page.locator(".quote-card").count() > 0, "motivational quote card present")

        # every sim link must be a real absolute http(s) URL
        hrefs = await page.locator("a.sim").get_attribute("href", timeout=5000) if False else None
        all_hrefs = await page.eval_on_selector_all(
            "a.sim", "els => els.map(e => e.getAttribute('href'))")
        bad = [h for h in all_hrefs if not re.match(r"^https?://\S+$", h or "")]
        check(not bad, "all sim hrefs are absolute http(s)", bad[:3])
        targets = await page.eval_on_selector_all(
            "a.sim", "els => els.map(e => e.getAttribute('target'))")
        check(all(t == "_blank" for t in targets), "every sim link opens in a new tab",
              [t for t in targets if t != "_blank"][:3])

        # platform label present on chips
        chip_txt = await page.locator("a.sim").first.inner_text()
        check(len(chip_txt.strip()) > 0, "sim chip shows platform name", chip_txt)
        await page.screenshot(path=f"{SHOT}/04-chapter-light.png", full_page=True)

        # ----------------------------------------------------------- filters
        print("\n[FILTERS]")
        await page.click('[data-filter="soon"]')
        await page.wait_for_timeout(450)
        only_soon = await page.locator(".topic").count()
        with_sims = await page.locator(".topic a.sim").count()
        check(with_sims == 0, "coming-soon filter hides topics that have sims", with_sims)
        check(only_soon > 0, "coming-soon filter shows empty topics", only_soon)
        await page.screenshot(path=f"{SHOT}/05-filter-soon.png", full_page=True)

        await page.click('[data-filter="ready"]')
        await page.wait_for_timeout(450)
        empty_topics = await page.locator(".topic.empty-topic").count()
        check(empty_topics == 0, "has-simulation filter hides empty topics", empty_topics)

        await page.click('[data-filter="all"]')
        await page.wait_for_timeout(450)
        check(await page.locator(".topic").count() == n_topic, "all filter restores full list",
              await page.locator(".topic").count())

        # ------------------------------------------------- sim click tracking
        print("\n[SIM CLICK TRACKING]")
        first_href = all_hrefs[0]
        async with page.expect_popup() as pop:
            await page.locator("a.sim").first.click()
        newpage = await pop.value
        await newpage.wait_for_timeout(400)
        print("        opened:", newpage.url[:90])
        check(newpage.url.startswith("http"), "click opened the real platform URL", newpage.url)
        await newpage.close()

        stored = await page.evaluate("Object.keys(JSON.parse(localStorage.getItem('simverse.opened.v1')||'{}'))")
        check(first_href in stored, "opened sim recorded in localStorage", stored[:2])
        check(await page.locator("a.sim.visited").count() > 0, "visited dot shown after click")

        # --------------------------------------------------------- progress
        print("\n[PROGRESS]")
        await page.goto(BASE + "/#/progress", wait_until="load")
        await page.wait_for_timeout(500)
        check(await page.locator(".recent-item").count() >= 1, "recent list shows the opened sim",
              await page.locator(".recent-item").count())
        ring_txt = (await page.locator(".ring text").text_content() or "").strip()
        print("        ring:", ring_txt)
        check("%" in ring_txt, "progress ring renders a percentage", ring_txt)
        check(ring_txt != "0%", "ring shows non-zero progress after opening a sim", ring_txt)
        await page.screenshot(path=f"{SHOT}/06-progress.png", full_page=True)

        # -------------------------------------------------------- platforms
        print("\n[PLATFORMS]")
        await page.goto(BASE + "/#/platforms", wait_until="load")
        await page.wait_for_timeout(500)
        n_pf = await page.locator(".pf-card").count()
        print("        platform cards:", n_pf)
        check(n_pf == 14, "14 platform cards", n_pf)
        await page.screenshot(path=f"{SHOT}/07-platforms.png", full_page=True)

        # ------------------------------------------------------------ about
        print("\n[ABOUT]")
        await page.goto(BASE + "/#/about", wait_until="load")
        await page.wait_for_timeout(400)
        check("SimVerse" in await page.locator(".h2").first.inner_text(), "about page renders")

        # --------------------------------------------------- search palette
        print("\n[COMMAND PALETTE]")
        await page.goto(BASE + "/#/", wait_until="load")
        await page.wait_for_timeout(400)
        await page.keyboard.press("Control+k")
        await page.wait_for_timeout(250)
        check(await page.locator("#palette").is_visible(), "palette opens with Ctrl+K")
        await page.fill("#palInput", "refraction")
        await page.wait_for_timeout(350)
        n_res = await page.locator(".pal-item").count()
        print("        results for 'refraction':", n_res)
        check(n_res > 0, "search returns results", n_res)
        await page.screenshot(path=f"{SHOT}/08-palette.png")
        first = await page.locator(".pal-item .nm b").first.inner_text()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(600)
        check(page.url.split("#")[1].startswith("/class/"), "enter navigates to a topic route", page.url)
        await page.screenshot(path=f"{SHOT}/09-deeplink.png", full_page=True)

        # ----------------------------------------------------- search page
        print("\n[SEARCH PAGE]")
        await page.goto(BASE + "/#/search?q=mole%20concept", wait_until="load")
        await page.wait_for_timeout(400)
        n_s = await page.locator(".sres").count()
        print("        results:", n_s)
        check(n_s > 0, "search page lists results", n_s)

        await page.goto(BASE + "/#/search?q=pair%20of%20linear%20equations", wait_until="load")
        await page.wait_for_timeout(400)
        n_s2 = await page.locator(".sres").count()
        print("        multi-word results:", n_s2)
        check(n_s2 > 1, "multi-word query returns several results", n_s2)
        mark = await page.locator(".sres mark").count()
        check(mark > 0, "matched words are highlighted", mark)
        await page.screenshot(path=f"{SHOT}/12-search-multiword.png", full_page=True)

        # ---------------------------------------------- deep-link to a topic
        print("\n[DEEP LINK]")
        await page.goto(BASE + "/#/class/11/chemistry/0?t=3", wait_until="load")
        await page.wait_for_timeout(700)
        check(await page.locator("#t3").count() == 1, "topic anchor #t3 exists")
        act = await page.locator("#t3 .act-code").count()
        print("        activity code present on topic:", act > 0)

        # ------------------------------------------------- mobile viewport
        print("\n[MOBILE 390px]")
        mob = await browser.new_page(viewport={"width": 390, "height": 844})
        await mob.goto(BASE + "/#/", wait_until="load")
        await mob.wait_for_timeout(500)
        overflow = await mob.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow <= 2, "no horizontal overflow on mobile", overflow)
        await mob.screenshot(path=f"{SHOT}/10-mobile-home.png", full_page=True)
        await mob.goto(BASE + "/#/class/10/physics/0", wait_until="load")
        await mob.wait_for_timeout(500)
        overflow2 = await mob.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(overflow2 <= 2, "no horizontal overflow on chapter page", overflow2)
        await mob.screenshot(path=f"{SHOT}/11-mobile-chapter.png", full_page=True)
        await mob.close()

        # ------------------------------------------------------- crawl links
        print("\n[CRAWL ALL ROUTES]")
        data = await page.evaluate("window.SIMVERSE_DATA")
        routes = ["#/"]
        for g, gn in data["grades"].items():
            routes.append(f"#/class/{g}")
            for s, sn in gn["subjects"].items():
                routes.append(f"#/class/{g}/{s}")
                for ci in range(len(sn["chapters"])):
                    routes.append(f"#/class/{g}/{s}/{ci}")
        print("        routes to visit:", len(routes))
        broken = []
        for r in routes:
            await page.goto(BASE + "/" + r, wait_until="load")
            await page.wait_for_timeout(45)
            nf = await page.locator("text=Page not found").count()
            empty = await page.evaluate("document.getElementById('view').innerText.trim().length")
            if nf or empty < 80:
                broken.append((r, nf, empty))
        check(not broken, "every route renders content", broken[:5])
        print(f"        visited {len(routes)} routes, broken={len(broken)}")

        print("\n[CONSOLE ERRORS]")
        real = [e for e in errors if "favicon" not in e and "net::ERR" not in e]
        check(not real, "no page/console errors", real[:6])

        await browser.close()

    print("\n" + "=" * 64)
    if failures:
        print(f"RESULT: {len(failures)} FAILURE(S)")
        for f in failures:
            print("   -", f)
        sys.exit(1)
    print("RESULT: ALL CHECKS PASSED")


asyncio.run(main())

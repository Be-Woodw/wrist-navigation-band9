package io.github.mi9pro.navigation;

import org.junit.Test;
import static org.junit.Assert.*;

/** Gaode may publish an actionable guidance card and a newer generic ongoing card. */
public class NavigationCandidateSelectorTest {
    private static NavigationParser.Result parse(boolean ongoing, String... fields) {
        return NavigationParser.parse(NavigationParser.AMAP_PACKAGE, ongoing, fields);
    }

    @Test public void prefersActionableCardEvenWhenGenericIsNewerInEitherOrder() {
        var actionable = parse(false, "高德地图", "82米后直行", "剩余18.3公里");
        var generic = parse(true, "高德地图持续为您导航", "正在为您步行导航");
        assertNotNull(actionable);
        assertNotNull(generic);
        assertEquals("straight", actionable.maneuver);
        assertEquals("82 米", actionable.distance);
        assertEquals("unknown", generic.maneuver);

        var forward = new NavigationCandidateSelector();
        forward.consider(actionable, 1000);
        forward.consider(generic, 2000);
        assertSame(actionable, forward.selected());

        var reversed = new NavigationCandidateSelector();
        reversed.consider(generic, 2000);
        reversed.consider(actionable, 1000);
        assertSame(actionable, reversed.selected());
    }

    @Test public void directionWithoutDistanceStillBeatsGenericStatus() {
        var generic = parse(true, "高德地图持续为您导航");
        var partial = parse(true, "前方右转");
        var selected = new NavigationCandidateSelector();
        selected.consider(partial, 1000);
        selected.consider(generic, 2000);
        assertSame(partial, selected.selected());
    }

    @Test public void newerActionableNotificationWinsEqualPriority() {
        var first = parse(false, "82米后直行");
        var second = parse(false, "75米后左转");
        var selected = new NavigationCandidateSelector();
        selected.consider(second, 2000);
        selected.consider(first, 1000);
        assertSame(second, selected.selected());
    }

    @Test public void genericStatusRemainsFallbackIfNoInstructionExists() {
        var generic = parse(true, "高德地图持续为您导航", "正在为您步行导航");
        var selected = new NavigationCandidateSelector();
        selected.consider(generic, 1000);
        assertSame(generic, selected.selected());
    }

    @Test public void explicitEndNewerThanGuidanceTakesPrecedence() {
        var guidance = parse(false, "82米后直行");
        var end = parse(false, "已到达目的地，导航结束");
        var generic = parse(true, "正在为您步行导航");
        var selected = new NavigationCandidateSelector();
        selected.consider(generic, 3000);
        selected.consider(guidance, 1000);
        selected.consider(end, 2000);
        assertSame(end, selected.selected());
    }

    @Test public void newRouteInstructionAfterPriorEndTakesPrecedence() {
        var guidance = parse(false, "82米后直行");
        var end = parse(false, "已到达目的地，导航结束");
        var selected = new NavigationCandidateSelector();
        selected.consider(end, 1000);
        selected.consider(guidance, 2000);
        assertSame(guidance, selected.selected());
    }

    @Test public void emptyAndUnrelatedCandidatesAreIgnored() {
        var selected = new NavigationCandidateSelector();
        selected.consider(null, 100);
        selected.consider(NavigationParser.parse("com.example.other", true, "82米后直行"), 200);
        assertNull(selected.selected());
    }

    @Test public void explicitEndAtSameTimeAsGuidanceTakesPrecedence() {
        var selected = new NavigationCandidateSelector();
        var guidance = parse(false, "82米后直行");
        var end = parse(false, "导航结束");
        selected.consider(guidance, 1000);
        selected.consider(end, 1000);
        assertSame(end, selected.selected());
    }
}

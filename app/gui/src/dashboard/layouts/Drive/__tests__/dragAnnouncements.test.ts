/** @file What a screen reader hears while rows of the drive's table are dragged. */
import { useDragAnnouncements } from '#/layouts/Drive/dragAnnouncements'
import { useText } from '$/providers/text'
import { describe, expect, test } from 'vitest'

const { getText } = useText()

const FOLDER = { title: 'Folder' }
const FILE = { title: 'File' }
const PROJECT = { title: 'Project' }

/** The live region's text, without the no-break space that makes a repeat a change. */
function spoken(announcements: ReturnType<typeof useDragAnnouncements>) {
  return announcements.message.value.replace(/\s$/, '')
}

describe('useDragAnnouncements', () => {
  test('is silent until a drag starts, and ignores drops of anything else', () => {
    const announcements = useDragAnnouncements()
    announcements.droppedInTable([FILE], { type: 'current' })
    announcements.rejected()
    announcements.droppedElsewhere(null)
    announcements.ended('move')
    expect(announcements.message.value).toBe('')
    expect(announcements.isDragging()).toBe(false)
  })

  test('names one asset by its title, and several by their count', () => {
    const one = useDragAnnouncements()
    one.started([FILE])
    expect(spoken(one)).toBe(getText('dragAnnouncementStarted', "'File'"))
    expect(spoken(one)).toBe(
      "Moving 'File'. Drop on a folder to move there, or press Escape to cancel.",
    )
    const several = useDragAnnouncements()
    several.started([FILE, PROJECT])
    expect(spoken(several)).toBe(getText('dragAnnouncementStarted', '2 items'))
    expect(several.isDragging()).toBe(true)
  })

  test('says which directory a drop moved the assets into', () => {
    const announcements = useDragAnnouncements()
    announcements.started([FILE, PROJECT])
    announcements.droppedInTable([FILE, PROJECT], { type: 'directory', title: 'Folder' })
    expect(spoken(announcements)).toBe("Dropped 2 items into 'Folder'.")
    // The `dragend` that follows the drop adds nothing.
    announcements.ended('move')
    expect(spoken(announcements)).toBe("Dropped 2 items into 'Folder'.")
    expect(announcements.isDragging()).toBe(false)
  })

  test('says a drop on the table moves into the current folder', () => {
    const announcements = useDragAnnouncements()
    announcements.started([FILE])
    announcements.droppedElsewhere(null)
    announcements.droppedInTable([FILE], { type: 'current' })
    announcements.ended('move')
    expect(spoken(announcements)).toBe(getText('dragAnnouncementDroppedHere', "'File'"))
  })

  test('counts only the assets that move', () => {
    const announcements = useDragAnnouncements()
    announcements.started([FILE, PROJECT])
    announcements.droppedInTable([PROJECT], { type: 'directory', title: 'Folder' })
    expect(spoken(announcements)).toBe("Dropped 'Project' into 'Folder'.")
  })

  test('says a drop that moves nothing, or that the table refuses, cancelled the move', () => {
    const nothing = useDragAnnouncements()
    nothing.started([FILE])
    nothing.droppedInTable([], { type: 'current' })
    expect(spoken(nothing)).toBe("Cancelled moving 'File'.")
    const refused = useDragAnnouncements()
    refused.started([FILE])
    refused.rejected()
    refused.ended('none')
    expect(spoken(refused)).toBe("Cancelled moving 'File'.")
  })

  test('says a drag ended without a drop was cancelled', () => {
    const announcements = useDragAnnouncements()
    announcements.started([FOLDER])
    announcements.ended('none')
    expect(spoken(announcements)).toBe(getText('dragAnnouncementCancelled', "'Folder'"))
    expect(announcements.isDragging()).toBe(false)
  })

  test('names a drop target outside the table by its accessible name', () => {
    const trash = document.createElement('button')
    trash.setAttribute('aria-label', 'Trash')
    const icon = document.createElement('span')
    trash.append(icon)
    const announcements = useDragAnnouncements()
    announcements.started([FILE])
    announcements.droppedElsewhere(icon)
    announcements.ended('move')
    expect(spoken(announcements)).toBe("Dropped 'File' on Trash.")
  })

  test('says a drop elsewhere happened even when its target has no name', () => {
    const unnamed = useDragAnnouncements()
    unnamed.started([FILE])
    unnamed.droppedElsewhere(document.createElement('div'))
    unnamed.ended('none')
    expect(spoken(unnamed)).toBe("Dropped 'File'.")
    // Out of the window, onto another application: only the drop effect tells.
    const outside = useDragAnnouncements()
    outside.started([FILE])
    outside.ended('copy')
    expect(spoken(outside)).toBe("Dropped 'File'.")
  })

  test('changes the text when the same message is repeated, so it is announced again', () => {
    const announcements = useDragAnnouncements()
    announcements.started([FILE])
    const first = announcements.message.value
    announcements.ended('none')
    announcements.started([FILE])
    expect(announcements.message.value).toBe(first)
    announcements.started([FILE])
    expect(announcements.message.value).not.toBe(first)
    expect(spoken(announcements)).toBe(first.replace(/\s$/, ''))
  })
})

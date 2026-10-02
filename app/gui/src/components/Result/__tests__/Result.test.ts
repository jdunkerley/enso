/** @file `Result.vue`'s `centered` prop, written as a bare attribute in a template. */
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { compile, defineComponent } from 'vue'
import Result from '../Result.vue'

function classesOf(template: string) {
  const wrapper = mount(defineComponent({ components: { Result }, render: compile(template) }))
  const classes = wrapper.get('section').classes()
  wrapper.unmount()
  return classes
}

describe('Result', () => {
  test('is centred by default', () => {
    expect(classesOf('<Result title="x" />')).toContain('m-auto')
  })

  test('a bare `centered` attribute centres it, as `centered: true` does', () => {
    expect(classesOf('<Result title="x" centered />')).toContain('m-auto')
  })

  test('`centered` takes the variant names', () => {
    expect(classesOf('<Result title="x" centered="horizontal" />')).toContain('mx-auto')
    expect(classesOf('<Result title="x" :centered="false" />')).not.toContain('m-auto')
  })
})

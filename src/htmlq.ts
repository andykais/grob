import { CSSSelect, parseDOM, domhandler, dom_serializer, DomUtils } from './deps.ts'


class Htmlq {
  private document: domhandler.ChildNode[] | domhandler.Element | domhandler.ChildNode
  public constructor(html: string | domhandler.Element | domhandler.ChildNode) {
    if (typeof html === 'string') {
      this.document = parseDOM(html)
    } else {
      this.document = html
    }
  }

  public attr(attribute_name: string) {
    if (Array.isArray(this.document)) {
      throw new Error('Cannot look up attribute on an array of nodes')
    }
    return DomUtils.getAttributeValue(this.document as domhandler.Element, attribute_name)
  }

  public text() {
    if (Array.isArray(this.document)) {
      throw new Error('Cannot look up find text on an array of nodes')
    }
    const text_content = DomUtils.textContent(this.document)
    if (text_content) return text_content
    const inner_text = DomUtils.innerText(this.document)
    return inner_text
  }

  public html() {
    return dom_serializer.default(this.document)
  }

  public select_one(css_selector: string) {
    const result = CSSSelect.selectOne(css_selector, this.document)
    if (result) {
      return new Htmlq(result)
    }
  }

  public select_all(css_selector: string) {
    const result = CSSSelect.selectAll(css_selector, this.document)
    return result.map(node => new Htmlq(node))
  }
}


export { Htmlq }

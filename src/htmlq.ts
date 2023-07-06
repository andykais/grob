import { CSSSelect, parseDOM, domhandler, DomUtils } from './deps.ts'


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
    if (this.document instanceof domhandler.Element) {
      return DomUtils.getAttributeValue(this.document, attribute_name)
    }
    if (Array.isArray(this.document)) {
      throw new Error('Cannot look up attribute on an array of nodes')
    }
    throw new Error('Cannot look up attribute on ChildNode')
  }

  public text() {
    if (Array.isArray(this.document)) {
      throw new Error('Cannot look up find text on an array of nodes')
    }
    return DomUtils.textContent(this.document)
  }

  public one(css_selector: string) {
    const result = CSSSelect.selectOne(css_selector, this.document)
    if (result) {
      return new Htmlq(result)
    }
  }

  public all(css_selector: string, attr?: string) {
    const result = CSSSelect.selectAll(css_selector, this.document)
    return result.map(node => new Htmlq(node))
  }
}


export { Htmlq }

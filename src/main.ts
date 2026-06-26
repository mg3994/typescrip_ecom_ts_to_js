import { AppState, LocationData } from './types/app';
import { SchemaExtractor } from './core/SchemaExtractor';
import { CartManager } from './core/CartManager';
import { LocationManager } from './core/LocationManager';
import { BloggerDataService } from './infrastructure/BloggerDataService';
import { GooglePayService } from './infrastructure/GooglePayService';
import { ProductRenderer } from './presentation/ProductRenderer';
import { CartRenderer } from './presentation/CartRenderer';
import { LocationRenderer } from './presentation/LocationRenderer';
import { UIManager } from './presentation/UIManager';

export class App {
  private state: AppState = {
    product: null,
    selectedVariants: {},
    currentSlide: 0,
    quantity: 1,
    lastClickedAttribute: null,
    selectedPackage: null
  };

  private gridPageSize = 20;
  private gridStartIndex = 1;
  private currentLabels: string[] = [];
  private currentSearchQuery: string = '';
  private displaySearchQuery: string = '';
  private searchKeywordsOnly: string = '';

  public CartManager = new CartManager();
  public LocationManager = new LocationManager();
  public BloggerDataService = new BloggerDataService();
  public GooglePayService = new GooglePayService();

  public ProductRenderer = new ProductRenderer();
  public CartRenderer = new CartRenderer(this.CartManager);
  public LocationRenderer = new LocationRenderer(this.LocationManager);

  constructor() {
    this.detectContext();
    this.exposeGlobals();
    this.init();
  }

  private detectContext(): void {
      const path = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);

      // 1. Detect Standard Label View
      if (path.includes('/search/label/')) {
          const label = path.split('/search/label/')[1].split('?')[0];
          if (label) this.currentLabels.push(decodeURIComponent(label));
      }

      // 2. Detect Search Query
      const rawQ = searchParams.get('q');
      if (rawQ !== null) {
          const trimmedQ = rawQ.trim().replace(/^["']|["']$/g, '').trim();

          if (trimmedQ === '') {
              // If ?q= is present but empty, check if we have any location data
              const loc = this.LocationManager.getData();
              const hasLocation = !!(loc.pin || loc.city);

              if (!hasLocation) {
                  // No query, no location -> Go to clean /search and reload
                  const newUrl = window.location.pathname;
                  if (window.location.search.includes('q=')) {
                      window.location.href = newUrl;
                      return;
                  }
              }

              this.currentSearchQuery = '';
              this.displaySearchQuery = '';
              this.searchKeywordsOnly = '';
          } else {
              // Keep technical data (labels, location) in both current and display query
              this.currentSearchQuery = trimmedQ;
              this.displaySearchQuery = trimmedQ;

              // searchKeywordsOnly strips both labels and technical location keys
              this.searchKeywordsOnly = trimmedQ
                .replace(/label:[^|\s]+/g, '')
                .replace(/postalCode:[^|\s]+/g, '')
                .replace(/addressLocality:[^|\s]+/g, '')
                .trim();

              // Extract labels for active highlighting
              const labelRegex = /label:([^|\s]+)/g;
              let match;
              while ((match = labelRegex.exec(trimmedQ)) !== null) {
                  if (match[1]) {
                      const labelName = decodeURIComponent(match[1].replace(/_/g, ' '));
                      if (!this.currentLabels.includes(labelName)) {
                          this.currentLabels.push(labelName);
                      }
                  }
              }
          }
      }
  }

  private formatLocationQuery(): string {
      const loc = this.LocationManager.getData();
      if (loc.pin) {
          return `postalCode: ${loc.pin}`;
      }
      if (loc.city) {
          return `addressLocality: ${loc.city}`;
      }
      return "";
  }

  private exposeGlobals(): void {
    (window as any).AntinnaEngine = this;
    (window as any).CartManager = this.CartManager;
    (window as any).LocationManager = this.LocationManager;
    (window as any).CartRenderer = this.CartRenderer;
    (window as any).LocationRenderer = this.LocationRenderer;
    (window as any).GooglePayService = this.GooglePayService;
    (window as any).UIManager = UIManager;

    (window as any).nextSlide = () => this.goToSlide(this.state.currentSlide + 1);
    (window as any).prevSlide = () => this.goToSlide(this.state.currentSlide - 1);
    (window as any).goToSlide = (i: number) => this.goToSlide(i);
    (window as any).syncDots = (el: HTMLElement) => this.syncDots(el);
    (window as any).showToast = (m: string, t: 'success' | 'error') => UIManager.showToast(m, t);
    (window as any).loadMorePosts = () => this.loadMorePosts();
    (window as any).refreshCartData = () => this.refreshCartData();
  }

  private init(): void {
    document.addEventListener("DOMContentLoaded", () => {
      this.LocationRenderer.init();
      this.CartRenderer.renderFab();
      this.setupEventListeners();
      this.loadProductData();
      this.loadGridData();
      this.updateCategoryLinks();
      this.highlightActiveLabels();
      this.initSearchInput();
    });
  }

  private initSearchInput(): void {
      const qInput = UIManager.el<HTMLInputElement>("search-q");
      if (qInput && this.displaySearchQuery) {
          qInput.value = this.displaySearchQuery;
      }
  }

  private updateCategoryLinks(): void {
      const keywords = this.searchKeywordsOnly.trim();
      const locString = this.formatLocationQuery();

      const catLinks = document.querySelectorAll<HTMLAnchorElement>('.cat-link');
      catLinks.forEach(link => {
          const text = link.textContent?.trim() || '';
          let finalQuery = '';

          if (text.toUpperCase() === 'ALL') {
              finalQuery = `${keywords} ${locString}`.trim();
          } else {
              finalQuery = `label:${text} ${keywords} ${locString}`.trim();
          }

          if (!finalQuery) {
              link.href = '/search';
          } else {
              const prettyQuery = encodeURIComponent(finalQuery)
                .replace(/%20/g, ' ')
                .replace(/%3A/g, ':');
              link.href = `/search?q=${prettyQuery}`;
          }
      });
  }

  private highlightActiveLabels(): void {
      const catLinks = document.querySelectorAll('.cat-link');
      if (this.currentLabels.length > 0) {
          catLinks.forEach(link => {
              const text = link.textContent?.trim();
              if (text?.toUpperCase() === 'ALL') {
                  link.classList.remove('active');
                  return;
              }

              const isMatch = this.currentLabels.some(label => {
                  return text === label;
              });
              if (isMatch) link.classList.add('active');
          });
      }
  }

  private setupEventListeners(): void {
    const qtyPlus = UIManager.el("qty-plus");
    const qtyMinus = UIManager.el("qty-minus");
    const addBtn = UIManager.el("add-to-cart-btn");
    const searchForm = UIManager.el<HTMLFormElement>("search-form");
    const confirmBtn = UIManager.el("cart-confirm-btn");

    if (qtyPlus) qtyPlus.onclick = () => {
      this.state.quantity++;
      UIManager.setContent("qty-val", String(this.state.quantity));
    };

    if (qtyMinus) qtyMinus.onclick = () => {
      if (this.state.quantity > 1) {
        this.state.quantity--;
        UIManager.setContent("qty-val", String(this.state.quantity));
      }
    };

    if (addBtn) addBtn.onclick = () => this.handleAddToCart();

    if (confirmBtn) {
      confirmBtn.onclick = () => {
        this.GooglePayService.initPayment(this.CartManager.getOrder());
      };
    }

    if (searchForm) {
      searchForm.onsubmit = (e) => {
        e.preventDefault();
        const qInput = UIManager.el<HTMLInputElement>("search-q");
        if (!qInput) return;

        const baseQuery = qInput.value.trim();
        const searchUrl = searchForm.getAttribute('action') || '/search';

        if (!baseQuery) {
            const loc = this.LocationManager.getData();
            if (!(loc.pin || loc.city)) {
                window.location.href = searchUrl;
                return;
            }
        }

        // Preserve technical data in the URL
        let finalQuery = encodeURIComponent(baseQuery)
            .replace(/%20/g, ' ')
            .replace(/%3A/g, ':')
            .replace(/%7C/g, '|');

        if (!finalQuery) {
            window.location.href = searchUrl;
        } else {
            window.location.href = `${searchUrl}?q=${finalQuery}`;
        }
      };
    }
  }

  private loadProductData(): void {
    setTimeout(() => {
      const rawBody = UIManager.el("post-body-raw");
      if (rawBody) {
        const data = SchemaExtractor.extractJsonLd<any>(rawBody.textContent || "");
        if (data) {
          this.state.product = data;
          this.ProductRenderer.render(data, this.state, (attr, val) => {
            this.state.selectedVariants[attr] = val;
            this.state.lastClickedAttribute = attr;
            this.ProductRenderer.render(this.state.product!, this.state, () => {});
          });
          if (data.offers?.seller || data.seller || data.provider) {
              this.ProductRenderer.renderSeller(data.offers?.seller || data.seller || data.provider);
          }
        }
      }
      UIManager.toggleClass("#initializing-state", "hidden", true);
      UIManager.toggleClass("#carousel-section", "hidden", false);
      UIManager.toggleClass("#details-section", "hidden", false);
    }, 100);
  }

  private async loadGridData(): Promise<void> {
    const grid = UIManager.el("app-grid");
    if (!grid) return;

    // Use current search query + current location for fetching.
    // If the location is already in currentSearchQuery, don't duplicate it.
    const locString = this.formatLocationQuery();
    let fetchQuery = this.currentSearchQuery;

    if (locString && !fetchQuery.includes(locString)) {
        fetchQuery = (fetchQuery + " " + locString).trim();
    }

    const { entries } = await this.BloggerDataService.fetchFeedData(50, 1, this.currentLabels, fetchQuery);

    if (grid.children.length === 0) {
        this.renderEntriesToGrid(entries, grid);
    } else {
        const cards = grid.querySelectorAll<HTMLAnchorElement>(".card");
        cards.forEach(card => {
          const url = card.href.split("?")[0].split("#")[0];
          const entry = entries.find(e => {
              const alternateLink = e.link.find((l: any) => l.rel === "alternate")?.href || "";
              return alternateLink.toLowerCase().includes(url.toLowerCase());
          });
          const data = entry
            ? this.BloggerDataService.extractSchemaFromEntry(entry)
            : SchemaExtractor.extractJsonLd<any>(card.querySelector(".grid-data")?.textContent || "");

          if (data) {
            this.renderGridCard(card, data);
          }
        });
    }
  }

  public async loadMorePosts(): Promise<void> {
    const grid = UIManager.el("app-grid");
    if (!grid) return;

    this.gridStartIndex += this.gridPageSize;

    const locString = this.formatLocationQuery();
    let fetchQuery = this.currentSearchQuery;
    if (locString && !fetchQuery.includes(locString)) {
        fetchQuery = (fetchQuery + " " + locString).trim();
    }

    const { entries, totalResults } = await this.BloggerDataService.fetchFeedData(this.gridPageSize, this.gridStartIndex, this.currentLabels, fetchQuery);

    this.renderEntriesToGrid(entries, grid);

    if (this.gridStartIndex + this.gridPageSize > totalResults) {
      UIManager.el("load-more-btn")?.classList.add("hidden");
    }
  }

  private renderEntriesToGrid(entries: any[], grid: HTMLElement): void {
      entries.forEach(entry => {
        const data = this.BloggerDataService.extractSchemaFromEntry(entry);
        if (data) {
          const url = entry.link.find((l: any) => l.rel === "alternate")?.href || "#";
          const card = document.createElement("a");
          card.className = "card";
          card.href = url;
          card.innerHTML = `
            <div class="card-img-wrapper">
               <div class="card-img-scroll" onscroll="AntinnaEngine.syncDots(this)">
                  <img class="card-img" src="${(Array.isArray(data.image) ? data.image[0] : (data.image?.url || data.image)) || 'https://via.placeholder.com/400x300?text=Antinna'}" loading="lazy"/>
               </div>
               <div class="card-dots"></div>
            </div>
            <div class="card-body">
              <div class="card-badge">Loading...</div>
              <h3 class="card-title">${data.name || "Untitled"}</h3>
              <div class="card-price">--</div>
            </div>
          `;
          grid.appendChild(card);
          this.renderGridCard(card, data);
        }
      });
  }

  public async refreshCartData(): Promise<void> {
    this.CartRenderer.setLoading(true);
    try {
        const order = this.CartManager.getOrder();
        const { entries } = await this.BloggerDataService.fetchFeedData(100, 1);

        order.orderedItem.forEach((item, idx) => {
          const url = (item.orderedItem as any).url;
          if (!url) return;

          const entry = entries.find(e => {
              const alternateLink = e.link.find((l: any) => l.rel === "alternate")?.href || "";
              return alternateLink.toLowerCase().includes(url.toLowerCase().split('?')[0].split('#')[0]);
          });

          const data = entry ? this.BloggerDataService.extractSchemaFromEntry(entry) : null;
          this.CartManager.updateItemDetails(idx, data);
        });
    } catch (e) {
        console.error("Refresh failed", e);
    } finally {
        this.CartRenderer.setLoading(false);
        this.CartRenderer.showModal();
    }
  }

  private renderGridCard(card: HTMLElement, data: any): void {
    const badge = card.querySelector(".card-badge");
    const price = card.querySelector(".card-price");
    const scroll = card.querySelector(".card-img-scroll");
    const dots = card.querySelector(".card-dots");

    const isBusiness = data["@type"] === "LocalBusiness" || data["@type"] === "Store" || data["@type"] === "Organization";

    if (badge) badge.textContent = isBusiness ? 'Business' : ((data["@type"] === 'ProductGroup' || data["@type"] === 'Product') ? 'Product' : 'Service');

    if (price) {
        if (isBusiness) {
            price.textContent = data.telephone || "Contact Us";
        } else {
            const variant = data.hasVariant ? data.hasVariant[0] : data;
            const { price: p, currency } = SchemaExtractor.extractPrice(variant.offers || variant);
            price.textContent = `${currency} ${p}`;
        }
    }

    const imgs = Array.isArray(data.image) ? data.image : [data.image];
    if (imgs[0] && scroll) {
      scroll.innerHTML = imgs.map((img: any) => `<img class="card-img" src="${img.url || img}" loading="lazy"/>`).join('');
      if (dots && imgs.length > 1) {
        dots.innerHTML = imgs.map((_: any, i: number) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('');
      }
    }
  }

  private handleAddToCart(): void {
    const p = this.state.product as any;
    if (!p) return;

    let variant = SchemaExtractor.findMatchingVariant(p, this.state.selectedVariants, this.state.lastClickedAttribute);

    if (this.state.selectedPackage) {
      variant = {
        ...variant,
        name: this.state.selectedPackage.itemOffered?.name || this.state.selectedPackage.name,
        offers: {
          price: this.state.selectedPackage.price,
          priceCurrency: this.state.selectedPackage.priceCurrency
        }
      };
    }

    const itemToStore = { ...variant, url: window.location.href.split('?')[0].split('#')[0] };

    for (let i = 0; i < this.state.quantity; i++) {
      this.CartManager.addItem(itemToStore, itemToStore.offers?.seller || p.seller || p.provider, this.state.selectedVariants);
    }
    this.CartRenderer.updateUI();
    UIManager.showToast("Added to Bag", "success");
  }

  public goToSlide(i: number): void {
    const inner = UIManager.el("carousel-inner");
    const items = document.querySelectorAll(".carousel-item");
    if (!inner || items.length === 0) return;

    if (i < 0) i = items.length - 1;
    if (i >= items.length) i = 0;

    this.state.currentSlide = i;
    inner.style.transform = `translateX(-${i * 100}%)`;

    document.querySelectorAll(".thumb").forEach((t, x) => t.classList.toggle("active", x === i));
  }

  public syncDots(el: HTMLElement): void {
    const idx = Math.round(el.scrollLeft / el.offsetWidth);
    const dots = el.parentElement?.querySelectorAll('.dot');
    dots?.forEach((d, i) => d.classList.toggle('active', i === idx));
  }
}

new App();

import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, query, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { ShoppingCart, User, X, Home, Clock, CheckCircle, History } from 'lucide-react';

// --- Global Firebase Configuration Variables (MANDATORY USE) ---
// These variables are provided by the hosting environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
// --- END Global Firebase Configuration Variables ---

// Initial menu data
const MENU_ITEMS = [
  { id: '1', name: 'Zesty Lemonade', price: 5.99, icon: '🍋', category: 'Drinks' },
  { id: '2', name: 'Classic Green Smoothie', price: 7.49, icon: '🥬', category: 'Drinks' },
  { id: '3', name: 'Açai Energy Bowl', price: 10.99, icon: '🫐', category: 'Bowls' },
  { id: '4', name: 'Protein Power Wrap', price: 9.99, icon: '🌯', category: 'Wraps' },
  { id: '5', name: 'Watermelon Refresher', price: 6.50, icon: '🍉', category: 'Drinks' },
  { id: '6', name: 'Mediterranean Salad Wrap', price: 11.50, icon: '🥗', category: 'Wraps' },
];

// Utility function for exponential backoff (required for API calls)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const App = () => {
  // --- Firebase State ---
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- App State ---
  const [cart, setCart] = useState([]);
  const [view, setView] = useState('menu'); // 'menu', 'cart', 'checkout', 'history'
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOrderPlaced, setIsOrderPlaced] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [orderHistory, setOrderHistory] = useState([]); // NEW: State for storing past orders

  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    try {
      if (!firebaseConfig.apiKey) {
        console.warn("Firebase config is missing API key. Running in local mock mode.");
        setUserId(crypto.randomUUID());
        setIsAuthReady(true);
        setIsLoading(false);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const userAuth = getAuth(app);

      setDb(firestore);
      setAuth(userAuth);

      // Authentication handler
      const unsubscribe = onAuthStateChanged(userAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // Sign in using custom token or anonymously
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(userAuth, initialAuthToken);
            } else {
              await signInAnonymously(userAuth);
            }
          } catch (e) {
            console.error("Firebase Auth Error:", e);
            setError("Failed to authenticate user.");
            setUserId(crypto.randomUUID()); // Fallback non-authenticated ID
          }
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Failed to initialize Firebase:", e);
      setError("Failed to initialize database services.");
      setIsLoading(false);
    }
  }, []);

  // --- Data Fetching and Real-time Cart Listener (Private Data) ---
  useEffect(() => {
    if (db && userId && isAuthReady) {
      setIsLoading(false);

      // Path for private user cart data: /artifacts/{appId}/users/{userId}/juisip_cart
      const cartRef = doc(db, `artifacts/${appId}/users/${userId}/juisip_cart/current`);

      const unsubscribe = onSnapshot(cartRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          try {
            // Firestore data is retrieved as a string and needs to be parsed
            const parsedCart = JSON.parse(data.itemsJson || '[]');
            setCart(parsedCart);
          } catch (e) {
            console.error("Error parsing cart data from Firestore:", e);
            setCart([]);
          }
        } else {
          // Document does not exist, initialize cart to empty array
          setCart([]);
        }
      }, (e) => {
        console.error("Error listening to cart changes:", e);
        setError("Could not load real-time cart data.");
      });

      // Clean up the listener on component unmount or dependency change
      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady]);

  // --- Real-time Order History Listener (Private User Data) ---
  useEffect(() => {
    if (db && userId && isAuthReady) {
        // Path for private history: /artifacts/{appId}/users/{userId}/juisip_history
        const historyColRef = collection(db, `artifacts/${appId}/users/${userId}/juisip_history`);

        const unsubscribeHistory = onSnapshot(historyColRef, (snapshot) => {
            const historyData = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Parse items back from JSON string
                    items: JSON.parse(data.itemsJson || '[]'),
                    // Ensure timestamp is handled correctly for display
                    placedAt: data.placedAt || new Date().toISOString(),
                    displayDate: new Date(data.placedAt).toLocaleString(),
                }
            });

            // Sort newest first based on placedAt ISO string
            historyData.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());

            setOrderHistory(historyData);
        }, (e) => {
            console.error("Error listening to order history:", e);
        });

        return () => unsubscribeHistory();
    }
}, [db, userId, isAuthReady]);


  // --- Data Writing (Updating Cart to Firestore) ---
  const updateCartInDb = async (newCart) => {
    if (!db || !userId) return;

    // Use exponential backoff for writing data
    const maxRetries = 3;
    const cartRef = doc(db, `artifacts/${appId}/users/${userId}/juisip_cart/current`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await setDoc(cartRef, {
          itemsJson: JSON.stringify(newCart),
          updatedAt: new Date().toISOString(),
        });
        return; // Success
      } catch (e) {
        if (attempt < maxRetries - 1) {
          console.warn(`Firestore write failed (Attempt ${attempt + 1}). Retrying...`);
          await sleep(1000 * (2 ** attempt)); // 1s, 2s, 4s delay
        } else {
          console.error("Failed to save cart to Firestore after multiple retries:", e);
          setError("Failed to save cart. Please check your connection.");
        }
      }
    }
  };

  // --- Cart Manipulation Logic ---
  const addToCart = (item) => {
    const existingItemIndex = cart.findIndex(cartItem => cartItem.id === item.id);
    let newCart;

    if (existingItemIndex > -1) {
      newCart = cart.map((cartItem, index) =>
        index === existingItemIndex
          ? { ...cartItem, quantity: cartItem.quantity + 1 }
          : cartItem
      );
    } else {
      newCart = [...cart, { ...item, quantity: 1 }];
    }
    setCart(newCart);
    updateCartInDb(newCart);
  };

  const updateQuantity = (itemId, change) => {
    const newCart = cart
      .map(item =>
        item.id === itemId
          ? { ...item, quantity: item.quantity + change }
          : item
      )
      .filter(item => item.quantity > 0); // Remove if quantity drops to 0

    setCart(newCart);
    updateCartInDb(newCart);
  };

  const removeFromCart = (itemId) => {
    const newCart = cart.filter(item => item.id !== itemId);
    setCart(newCart);
    updateCartInDb(newCart);
  };

  const clearCart = () => {
    setCart([]);
    updateCartInDb([]);
  };

  // --- Calculated Values ---
  const cartTotalItems = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const cartSubtotal = useMemo(() =>
    cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );

  const taxRate = 0.08;
  const taxAmount = cartSubtotal * taxRate;
  const deliveryFee = cartSubtotal > 0 ? 5.00 : 0.00;
  const grandTotal = cartSubtotal + taxAmount + deliveryFee;

  // --- Categories ---
  const categories = useMemo(() => {
    const uniqueCategories = new Set(MENU_ITEMS.map(item => item.category));
    return ['all', ...Array.from(uniqueCategories)];
  }, []);

  const filteredMenu = useMemo(() => {
    if (activeCategory === 'all') {
      return MENU_ITEMS;
    }
    return MENU_ITEMS.filter(item => item.category === activeCategory);
  }, [activeCategory]);

  // --- Components ---

  const Header = () => (
    <header className="bg-white shadow-lg p-4 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto flex justify-between items-center">
        <h1 className="text-3xl font-extrabold text-lime-600 tracking-tight">
          JuiSip <span className="text-lime-400">Cloud Kitchen</span>
        </h1>
        <div className="flex items-center space-x-4">
          <div className="text-gray-500 text-sm flex items-center">
            <User className="w-4 h-4 mr-1" />
            <span className="truncate max-w-[80px] sm:max-w-none">{userId || 'Loading...'}</span>
          </div>
          {/* HISTORY BUTTON (Desktop) */}
          <button
            onClick={() => setView('history')}
            className={`p-2 rounded-full transition duration-150 shadow-md ${view === 'history' ? 'bg-lime-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            aria-label="View order history"
          >
            <History className="w-5 h-5" />
          </button>
          <button
            onClick={() => setView('cart')}
            className="relative p-2 bg-lime-500 text-white rounded-full hover:bg-lime-600 transition duration-150 shadow-md"
            aria-label="View shopping cart"
          >
            <ShoppingCart className="w-5 h-5" />
            {cartTotalItems > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 w-5 bg-red-500 text-xs font-bold rounded-full">
                {cartTotalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );

  const FooterNav = () => (
    <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 shadow-2xl md:hidden">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        <button onClick={() => setView('menu')} className={`flex flex-col items-center justify-center p-2 transition duration-150 ${view === 'menu' ? 'text-lime-600 font-semibold' : 'text-gray-500 hover:text-lime-500'}`}>
          <Home className="w-5 h-5" />
          <span className="text-xs mt-1">Menu</span>
        </button>
        <button onClick={() => setView('cart')} className={`relative flex flex-col items-center justify-center p-2 transition duration-150 ${view === 'cart' ? 'text-lime-600 font-semibold' : 'text-gray-500 hover:text-lime-500'}`}>
          <ShoppingCart className="w-5 h-5" />
          {cartTotalItems > 0 && (
            <span className="absolute top-0 right-3 flex items-center justify-center h-4 w-4 bg-red-500 text-white text-[10px] font-bold rounded-full">
              {cartTotalItems}
            </span>
          )}
          <span className="text-xs mt-1">Cart</span>
        </button>
        {/* HISTORY BUTTON (Mobile) */}
        <button onClick={() => setView('history')} className={`flex flex-col items-center justify-center p-2 transition duration-150 ${view === 'history' ? 'text-lime-600 font-semibold' : 'text-gray-500 hover:text-lime-500'}`}>
          <History className="w-5 h-5" />
          <span className="text-xs mt-1">History</span>
        </button>
      </div>
    </footer>
  );

  const MenuScreen = () => (
    <div className="py-6 px-4 max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 text-gray-800">Fresh Menu Today</h2>

      {/* Category Tabs */}
      <div className="flex space-x-2 overflow-x-auto pb-4 sticky top-[72px] bg-white z-40 mb-4 rounded-xl shadow-inner p-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors duration-200 whitespace-nowrap capitalize ${
              activeCategory === cat
                ? 'bg-lime-600 text-white shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-lime-100'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredMenu.map(item => (
          <div
            key={item.id}
            className="bg-white p-5 rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-100 flex items-center justify-between"
          >
            <div className="flex items-center">
              <span className="text-3xl mr-4">{item.icon}</span>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{item.name}</h3>
                <p className="text-lime-600 font-bold">${item.price.toFixed(2)}</p>
                <p className="text-xs text-gray-500 capitalize">{item.category}</p>
              </div>
            </div>
            <button
              onClick={() => addToCart(item)}
              className="px-4 py-2 bg-lime-500 text-white font-semibold rounded-full hover:bg-lime-600 transition-transform duration-150 active:scale-95 shadow-lg"
              aria-label={`Add ${item.name} to cart`}
            >
              Add
            </button>
          </div>
        ))}
      </div>
      <div className="h-16 md:h-0"></div> {/* Spacer for mobile footer */}
    </div>
  );

  const CartScreen = () => (
    <div className="py-6 px-4 max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 text-gray-800">Your Cart ({cartTotalItems} Items)</h2>

      {cart.length === 0 ? (
        <div className="text-center p-10 bg-white rounded-xl shadow-lg border-2 border-dashed border-gray-200">
          <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-xl font-semibold text-gray-600">Your sip list is empty.</p>
          <p className="text-gray-500 mt-2">Time to add some refreshing juices or bowls!</p>
          <button
            onClick={() => setView('menu')}
            className="mt-6 px-6 py-3 bg-lime-500 text-white rounded-full font-semibold hover:bg-lime-600 transition duration-150 shadow-lg"
          >
            Back to Menu
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Cart Items List */}
          <div className="lg:col-span-2 space-y-4">
            {cart.map(item => (
              <div
                key={item.id}
                className="bg-white p-4 rounded-xl shadow-md flex items-center justify-between border border-gray-100"
              >
                <div className="flex items-center">
                  <span className="text-2xl mr-4">{item.icon}</span>
                  <div>
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    <p className="text-sm text-gray-500">${item.price.toFixed(2)} each</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {/* Quantity Controls */}
                  <div className="flex items-center border border-gray-300 rounded-full bg-gray-50">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="p-2 text-gray-600 hover:bg-gray-200 rounded-l-full transition-colors duration-100"
                      aria-label="Decrease quantity"
                    >
                      -
                    </button>
                    <span className="px-3 font-medium text-gray-800">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="p-2 text-gray-600 hover:bg-gray-200 rounded-r-full transition-colors duration-100"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>

                  <p className="font-bold text-lime-600 w-16 text-right">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>

                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1 text-red-500 hover:text-red-700 transition duration-150"
                    aria-label="Remove item from cart"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
            <button onClick={clearCart} className="text-red-500 hover:underline text-sm mt-4">
              Clear All Items
            </button>
          </div>

          {/* Cart Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-xl shadow-lg sticky top-24 border border-gray-100">
              <h3 className="text-xl font-bold mb-4 border-b pb-2 text-gray-800">Order Summary</h3>
              <dl className="space-y-2 text-gray-700">
                <div className="flex justify-between">
                  <dt>Subtotal ({cartTotalItems} items)</dt>
                  <dd>${cartSubtotal.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Tax (8.0%)</dt>
                  <dd>${taxAmount.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Delivery Fee</dt>
                  <dd>${deliveryFee.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between pt-4 border-t border-gray-200 mt-4 font-bold text-lg text-gray-900">
                  <dt>Grand Total</dt>
                  <dd>${grandTotal.toFixed(2)}</dd>
                </div>
              </dl>

              <button
                onClick={() => setView('checkout')}
                className="w-full mt-6 py-3 bg-lime-500 text-white rounded-xl font-bold text-lg hover:bg-lime-600 transition-colors duration-150 active:scale-[0.99] shadow-xl"
              >
                Proceed to Checkout
              </button>
              <button
                onClick={() => setView('menu')}
                className="w-full mt-2 py-2 text-lime-600 bg-lime-50 hover:bg-lime-100 rounded-xl transition-colors duration-150"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="h-16 md:h-0"></div> {/* Spacer for mobile footer */}
    </div>
  );

  const CheckoutScreen = () => {
    // UPDATED: Logic to save the order to history collection before clearing the cart
    const handlePlaceOrder = async () => {
      if (!cart.length || grandTotal === 0 || !db || !userId) return;

      setIsLoading(true);
      const orderId = Math.floor(Math.random() * 90000) + 10000;
      const now = new Date().toISOString();

      const orderData = {
          orderId: orderId,
          userId: userId,
          itemsJson: JSON.stringify(cart), // Save complex array as JSON string
          grandTotal: grandTotal,
          subtotal: cartSubtotal,
          deliveryFee: deliveryFee,
          taxAmount: taxAmount,
          placedAt: now,
          status: 'Preparing', // Initial status
      };

      try {
          // 1. Add order to the private history collection
          const historyColRef = collection(db, `artifacts/${appId}/users/${userId}/juisip_history`);
          await addDoc(historyColRef, orderData);

          // 2. Simulate network processing time
          await sleep(1000);

          // 3. Clear the cart in the database (this triggers the cart listener to empty the UI cart state)
          await updateCartInDb([]);

          // Set order placed flag to trigger confirmation screen rendering
          setIsOrderPlaced(true);
      } catch (e) {
          console.error("Failed to place order:", e);
          setError("Failed to place order due to a database error.");
      } finally {
          setIsLoading(false);
      }
    };

    if (isOrderPlaced) {
      return (
        <div className="py-12 px-4 max-w-4xl mx-auto text-center">
          <div className="bg-white p-8 rounded-xl shadow-2xl border-4 border-lime-500">
            <CheckCircle className="w-16 h-16 text-lime-500 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-gray-800 mb-3">Order Confirmed!</h2>
            <p className="text-xl text-gray-600 mb-6">Your order #{orderHistory[0]?.orderId || '...'} has been placed.</p>
            <p className="text-gray-500 mb-8">
              Thank you for sipping with JuiSip. You will receive a notification when your items are ready for delivery.
            </p>
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => { setView('menu'); setIsOrderPlaced(false); }}
                className="px-6 py-3 bg-lime-500 text-white rounded-full font-semibold hover:bg-lime-600 transition duration-150 shadow-lg"
              >
                Start New Order
              </button>
               <button
                onClick={() => { setView('history'); setIsOrderPlaced(false); }}
                className="px-6 py-3 border border-lime-500 text-lime-600 rounded-full font-semibold hover:bg-lime-50 transition duration-150 shadow-lg"
              >
                View History
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="py-6 px-4 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-6 text-gray-800">Final Checkout</h2>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Order Details */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
              <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Delivery Information</h3>
              <form className="space-y-4">
                <input type="text" placeholder="Full Name" defaultValue="Jane Doe" required className="w-full p-3 border border-gray-300 rounded-lg focus:ring-lime-500 focus:border-lime-500 transition-colors"/>
                <input type="tel" placeholder="Phone Number" defaultValue="555-123-4567" required className="w-full p-3 border border-gray-300 rounded-lg focus:ring-lime-500 focus:border-lime-500 transition-colors"/>
                <textarea placeholder="Delivery Address" defaultValue="123 Fresh Juice Lane, Apt 4B" required rows="3" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-lime-500 focus:border-lime-500 transition-colors"></textarea>
                <div className="flex items-center space-x-2">
                  <Clock className="w-5 h-5 text-lime-600" />
                  <p className="text-sm text-gray-600">Estimated Delivery: 30 - 45 minutes</p>
                </div>
              </form>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
              <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Payment Method</h3>
              <p className="text-gray-600">Simulated payment: Cash on Delivery</p>
            </div>

            <button
              onClick={() => setView('cart')}
              className="flex items-center text-lime-600 hover:underline transition duration-150"
            >
              &larr; Back to Cart
            </button>
          </div>

          {/* Final Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-xl shadow-lg sticky top-24 border border-gray-100">
              <h3 className="text-xl font-bold mb-4 border-b pb-2 text-gray-800">Final Cost</h3>
              <dl className="space-y-2 text-gray-700">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>${cartSubtotal.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Tax (8.0%)</dt>
                  <dd>${taxAmount.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Delivery Fee</dt>
                  <dd>${deliveryFee.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between pt-4 border-t border-gray-200 mt-4 font-bold text-xl text-gray-900">
                  <dt>Total Due</dt>
                  <dd>${grandTotal.toFixed(2)}</dd>
                </div>
              </dl>

              <button
                onClick={handlePlaceOrder}
                disabled={isLoading || grandTotal === 0}
                className={`w-full mt-6 py-4 rounded-xl font-bold text-xl transition-all duration-300 shadow-2xl ${
                  isLoading || grandTotal === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-lime-500 text-white hover:bg-lime-600 active:scale-[0.99]'
                }`}
              >
                {isLoading ? 'Processing Order...' : 'Place Order Now'}
              </button>
              {isLoading && (
                 <p className="text-center text-sm text-lime-600 mt-2">Saving order to database...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // NEW: Component to display past orders
  const OrderHistoryScreen = () => {
    if (orderHistory.length === 0) {
        return (
            <div className="py-12 px-4 max-w-4xl mx-auto text-center">
                <div className="bg-white p-10 rounded-xl shadow-lg border-2 border-dashed border-gray-200">
                    <History className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-xl font-semibold text-gray-600">No past orders found.</p>
                    <p className="text-gray-500 mt-2">Start your first order today!</p>
                    <button
                        onClick={() => setView('menu')}
                        className="mt-6 px-6 py-3 bg-lime-500 text-white rounded-full font-semibold hover:bg-lime-600 transition duration-150 shadow-lg"
                    >
                        Browse Menu
                    </button>
                </div>
                <div className="text-sm text-gray-500 mt-6">
                  <p>User ID: {userId}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="py-6 px-4 max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 text-gray-800">Your Order History</h2>

            <div className="space-y-6">
                {orderHistory.map(order => (
                    <div key={order.id} className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                        <div className="flex justify-between items-start border-b pb-3 mb-3">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Order #{order.orderId}</h3>
                                <p className="text-sm text-gray-500 mt-1">Placed on: {order.displayDate}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-lime-600">${order.grandTotal.toFixed(2)}</p>
                                <span className={`inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full mt-1 ${
                                    order.status === 'Delivered' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                    <Clock className="w-3 h-3 mr-1" />
                                    {order.status}
                                </span>
                            </div>
                        </div>

                        <ul className="space-y-2 text-sm text-gray-700">
                            {order.items.map(item => (
                                <li key={item.id} className="flex justify-between">
                                    <span className="flex items-center">
                                        <span className="mr-2">{item.icon}</span>
                                        {item.name}
                                    </span>
                                    <span className="font-medium">
                                        {item.quantity} x ${item.price.toFixed(2)}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <button
                            onClick={() => { /* Re-order logic can be implemented here */ }}
                            className="mt-4 px-4 py-2 bg-lime-50 text-lime-600 rounded-full text-sm font-semibold hover:bg-lime-100 transition duration-150"
                        >
                            Reorder (Simulated)
                        </button>
                    </div>
                ))}
            </div>
             <div className="h-16 md:h-0"></div> {/* Spacer for mobile footer */}
        </div>
    );
  };


  const renderContent = () => {
    if (error) {
        return (
            <div className="text-center p-12 max-w-lg mx-auto bg-red-50 border-red-400 border rounded-xl m-4 mt-8 shadow-xl">
                <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-red-800">Application Error</h2>
                <p className="text-red-700 mt-2">{error}</p>
                <p className="text-red-600 mt-4 text-sm">Please check the console for details.</p>
            </div>
        );
    }

    if (isLoading && !isAuthReady) {
        return (
            <div className="flex flex-col items-center justify-center h-[80vh] text-gray-600">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-lime-500 mb-4"></div>
                <p className="text-lg font-semibold">Connecting to JuiSip services...</p>
            </div>
        );
    }

    switch (view) {
      case 'cart':
        return <CartScreen />;
      case 'checkout':
        return <CheckoutScreen />;
      case 'history': // NEW: History view
        return <OrderHistoryScreen />;
      case 'menu':
      default:
        return <MenuScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-16 md:pb-0">
      <Header />
      <main className="min-h-[calc(100vh-64px)]">
        {renderContent()}
      </main>
      <FooterNav />
    </div>
  );
};

export default App;

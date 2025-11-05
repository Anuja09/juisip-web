import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc, setLogLevel, writeBatch } from 'firebase/firestore';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCcw, ShoppingCart, X, Plus, Minus, CheckCircle, Info, Trash2 } from 'lucide-react';

// Set Firebase log level to Debug
setLogLevel('Debug');

// --- Global Variables & Constants ---

// Initialize Firebase Config and App ID (provided by environment)
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// Sanitize the appId to ensure it does not contain Firestore path separators,
// which seems to be the cause of the "Invalid document reference" error.
const appId = rawAppId.replace(/[/\\]/g, '-');

const initialCartState = {
    items: [],
    total: 0,
    checkoutId: null,
};

const JUICES = [
    { id: 'fresh-orange', name: 'Fresh Orange', price: 5.50, color: 'bg-orange-400', image: '🍊' },
    { id: 'green-detox', name: 'Green Detox', price: 6.80, color: 'bg-green-400', image: '🥦' },
    { id: 'tropical-punch', name: 'Tropical Punch', price: 7.20, color: 'bg-yellow-400', image: '🍍' },
    { id: 'berry-blast', name: 'Berry Blast', price: 6.00, color: 'bg-red-400', image: '🍓' },
];

// --- Firebase Utilities ---

// Helper function to get a document reference path for private user data
const getPrivateDocRef = (db, appId, userId, collectionName, docId) => {
    // Path structure: artifacts/{appId}/users/{userId}/[collectionName]/[docId] (6 segments)
    return doc(db, 'artifacts', appId, 'users', userId, collectionName, docId);
};

// --- Custom Components ---

/**
 * Reusable Modal component for customizers and cart view.
 */
const Modal = ({ title, onClose, children }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col transform transition-all duration-300 scale-100 opacity-100">
                {/* Modal Header */}
                <div className="p-4 sm:p-6 flex justify-between items-center border-b border-gray-100">
                    <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
                    <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-800 rounded-full transition" aria-label="Close modal">
                        <X size={20} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="overflow-y-auto p-4 sm:p-6 flex-grow">
                    {children}
                </div>
            </div>
        </div>
    );
};

/**
 * MessageToast component for notifications.
 */
const MessageToast = ({ message, setMessage }) => {
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => {
                setMessage(null);
            }, 3000); // Hide after 3 seconds
            return () => clearTimeout(timer);
        }
    }, [message, setMessage]);

    if (!message) return null;

    return (
        <div className="fixed top-4 right-4 z-50">
            <div className="flex items-center p-4 bg-green-500 text-white rounded-lg shadow-xl animate-fade-in-down transition-all duration-300">
                <CheckCircle className="w-5 h-5 mr-3" />
                <span className="font-medium">{message}</span>
            </div>
        </div>
    );
};


/**
 * Card component for displaying a juice option.
 */
const JuiceCard = ({ juice, onCustomize }) => (
    <div
        className={`relative p-6 ${juice.color} rounded-2xl shadow-lg hover:shadow-xl transition duration-300 ease-in-out cursor-pointer transform hover:-translate-y-1`}
        onClick={() => onCustomize(juice)}
    >
        <div className="text-5xl mb-3 text-center">{juice.image}</div>
        <h2 className="text-2xl font-extrabold text-white mb-1 text-center">{juice.name}</h2>
        <p className="text-sm font-semibold text-white text-center mb-4">Starts at ${juice.price.toFixed(2)}</p>

        <button
            onClick={(e) => { e.stopPropagation(); onCustomize(juice); }}
            className="w-full bg-white text-green-600 font-bold py-2 rounded-xl shadow-md hover:bg-gray-100 transition duration-150"
        >
            Customize
        </button>
    </div>
);


/**
 * Form for customizing juice options (size, sweetness, additions).
 */
const CustomizationForm = ({ juice, addToCart }) => {
    const [selectedSize, setSelectedSize] = useState('Medium');
    const [selectedSweetness, setSelectedSweetness] = useState('Regular');
    const [selectedAdditions, setSelectedAdditions] = useState([]);
    const [quantity, setQuantity] = useState(1);
    const [isAdding, setIsAdding] = useState(false);

    const availableAdditions = useMemo(() => ([
        { name: 'Protein Powder', price: 1.50 },
        { name: 'Chia Seeds', price: 0.75 },
        { name: 'Ginger Shot', price: 1.00 },
        { name: 'Spinach Boost', price: 0.50 },
    ]), []);

    const handleToggleAddition = (name, price) => {
        setSelectedAdditions(prev =>
            prev.includes(name)
                ? prev.filter(a => a !== name)
                : [...prev, name]
        );
    };

    const calculateItemPrice = useCallback(() => {
        let basePrice = juice.price;
        let additionCost = availableAdditions
            .filter(a => selectedAdditions.includes(a.name))
            .reduce((sum, a) => sum + a.price, 0);

        // Size price adjustment (simple example)
        if (selectedSize === 'Large') additionCost += 1.50;
        if (selectedSize === 'Small') additionCost -= 0.50;

        return basePrice + additionCost;
    }, [juice.price, selectedSize, selectedAdditions, availableAdditions]);

    const finalPrice = useMemo(() => calculateItemPrice(), [calculateItemPrice]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsAdding(true);
        try {
            const item = {
                id: crypto.randomUUID(), // Unique ID for this specific cart item
                juiceId: juice.id,
                name: juice.name,
                basePrice: juice.price,
                price: finalPrice,
                quantity: quantity,
                size: selectedSize,
                sweetness: selectedSweetness,
                additions: selectedAdditions,
                color: juice.color,
                image: juice.image,
            };
            await addToCart(item);
        } catch (error) {
            console.error("Failed to add to cart:", error);
        } finally {
            setIsAdding(false);
        }
    };

    const renderOption = (value, label, selected, onClick) => (
        <button
            key={value}
            type="button"
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selected ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={onClick}
        >
            {label}
        </button>
    );

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Size Selector */}
            <div>
                <label className="block text-lg font-semibold text-gray-800 mb-2">Size</label>
                <div className="flex space-x-3">
                    {['Small', 'Medium', 'Large'].map(size =>
                        renderOption(size, size, selectedSize === size, () => setSelectedSize(size))
                    )}
                </div>
            </div>

            {/* Sweetness Selector */}
            <div>
                <label className="block text-lg font-semibold text-gray-800 mb-2">Sweetness</label>
                <div className="flex space-x-3">
                    {['Low', 'Regular', 'Extra'].map(sweetness =>
                        renderOption(sweetness, sweetness, selectedSweetness === sweetness, () => setSelectedSweetness(sweetness))
                    )}
                </div>
            </div>

            {/* Additions Selector */}
            <div>
                <label className="block text-lg font-semibold text-gray-800 mb-2">Additions (Optional)</label>
                <div className="grid grid-cols-2 gap-3">
                    {availableAdditions.map(addition => (
                        <button
                            key={addition.name}
                            type="button"
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                selectedAdditions.includes(addition.name)
                                    ? 'bg-blue-500 border-blue-500 text-white shadow-lg'
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                            }`}
                            onClick={() => handleToggleAddition(addition.name, addition.price)}
                        >
                            <span className="font-medium text-left">{addition.name}</span>
                            <span className={`text-sm font-semibold ${selectedAdditions.includes(addition.name) ? 'text-blue-100' : 'text-gray-500'}`}>
                                +${addition.price.toFixed(2)}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Quantity and Total */}
            <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                <div>
                    <label className="block text-lg font-semibold text-gray-800 mb-2">Quantity</label>
                    <div className="flex items-center space-x-2">
                        <button
                            type="button"
                            className="p-1.5 border border-gray-300 rounded-full text-gray-600 hover:bg-gray-100"
                            onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        >
                            <Minus size={18} />
                        </button>
                        <span className="text-xl font-bold w-6 text-center">{quantity}</span>
                        <button
                            type="button"
                            className="p-1.5 border border-gray-300 rounded-full text-gray-600 hover:bg-gray-100"
                            onClick={() => setQuantity(q => q + 1)}
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>

                <div className="text-right">
                    <p className="text-lg font-semibold text-gray-500">Item Price</p>
                    <p className="text-3xl font-extrabold text-green-600">${finalPrice.toFixed(2)}</p>
                </div>
            </div>


            {/* Add to Cart Button */}
            <button
                type="submit"
                className="w-full bg-green-600 text-white text-xl font-bold py-3 rounded-xl shadow-lg hover:bg-green-700 transition duration-200 disabled:bg-green-400 flex items-center justify-center space-x-2"
                disabled={isAdding}
            >
                {isAdding ? (
                    <>
                        <RefreshCcw className="w-5 h-5 animate-spin" />
                        <span>Adding...</span>
                    </>
                ) : (
                    <span>Add {quantity} to Cart (${(finalPrice * quantity).toFixed(2)})</span>
                )}
            </button>
        </form>
    );
};

/**
 * Component for viewing and managing the cart contents.
 */
const CartView = ({ cart, updateCartItemQuantity, removeItemFromCart }) => {
    if (cart.items.length === 0) {
        return (
            <div className="text-center py-10">
                <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-xl text-gray-600">Your cart is empty.</p>
                <p className="text-sm text-gray-400">Time to get juicing!</p>
            </div>
        );
    }

    const handleQuantityChange = (item, delta) => {
        const newQuantity = item.quantity + delta;
        if (newQuantity > 0) {
            updateCartItemQuantity(item.id, newQuantity);
        } else {
            removeItemFromCart(item.id);
        }
    };

    return (
        <div className="space-y-6">
            {/* Cart Items List */}
            <div className="space-y-4">
                {cart.items.map((item, index) => (
                    <div key={item.id || index} className="flex items-start bg-gray-50 p-4 rounded-xl shadow-sm">
                        <div className="text-3xl mr-4">{item.image}</div>

                        <div className="flex-1 min-w-0 pr-4">
                            <p className="font-bold text-gray-800">{item.name}</p>
                            <p className="text-sm text-gray-500 truncate">
                                {item.size} / {item.sweetness} / {item.additions.join(', ') || 'No additions'}
                            </p>
                            <p className="text-lg font-extrabold text-green-600 mt-1">${(item.price * item.quantity).toFixed(2)}</p>
                        </div>

                        <div className="flex flex-col items-end space-y-2">
                            {/* Quantity Controls */}
                            <div className="flex items-center space-x-1 border border-gray-300 rounded-full">
                                <button
                                    className="p-1 text-gray-600 hover:bg-gray-200 rounded-l-full transition"
                                    onClick={() => handleQuantityChange(item, -1)}
                                    aria-label="Decrease quantity"
                                >
                                    <Minus size={16} />
                                </button>
                                <span className="text-sm font-semibold w-5 text-center">{item.quantity}</span>
                                <button
                                    className="p-1 text-gray-600 hover:bg-gray-200 rounded-r-full transition"
                                    onClick={() => handleQuantityChange(item, 1)}
                                    aria-label="Increase quantity"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>

                            {/* Remove Button */}
                            <button
                                className="text-xs text-red-500 hover:text-red-700 transition flex items-center"
                                onClick={() => removeItemFromCart(item.id)}
                                aria-label="Remove item"
                            >
                                <Trash2 size={14} className="mr-1" />
                                Remove
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Cart Summary */}
            <div className="pt-4 border-t-2 border-green-100 space-y-2">
                <div className="flex justify-between font-semibold text-lg text-gray-700">
                    <span>Subtotal:</span>
                    <span>${cart.total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-xl text-green-600">
                    <span>Total:</span>
                    <span>${cart.total.toFixed(2)}</span>
                </div>
            </div>

            {/* Checkout Button */}
            <button
                className="w-full bg-green-600 text-white text-xl font-bold py-3 rounded-xl shadow-lg hover:bg-green-700 transition duration-200 mt-4"
                onClick={() => alert("Simulated Checkout! Total: $" + cart.total.toFixed(2))} // Use a custom modal for real world
            >
                Proceed to Checkout
            </button>
        </div>
    );
};

/**
 * Header component with logo and cart button.
 */
const Header = ({ setShowCart, cartItemCount }) => (
    <header className="w-full bg-white shadow-lg sticky top-0 z-40">
        <div className="container max-w-4xl mx-auto flex justify-between items-center p-4">
            <div className="flex items-center space-x-2">
                <span className="text-3xl">🥤</span>
                <h1 className="text-3xl font-black text-gray-800 tracking-tighter">JuiSip</h1>
            </div>
            <button
                onClick={() => setShowCart(true)}
                className="relative p-3 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition duration-150 shadow-md"
                aria-label={`Cart with ${cartItemCount} items`}
            >
                <ShoppingCart size={24} />
                {cartItemCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[24px] shadow-lg">
                        {cartItemCount}
                    </span>
                )}
            </button>
        </div>
    </header>
);

/**
 * Main application component.
 */
const App = () => {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);

    const [cart, setCart] = useState(initialCartState);
    const [showCart, setShowCart] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [selectedJuice, setSelectedJuice] = useState(null);
    const [message, setMessage] = useState(null);

    // --- Firebase & Auth Initialization ---
    useEffect(() => {
        try {
            const firebaseApp = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(firebaseApp);
            const firebaseAuth = getAuth(firebaseApp);

            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Authentication listener
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setCurrentUser(user);
                    setUserId(user.uid);
                    console.log("Authenticated user:", user.uid);
                } else {
                    // Try to sign in anonymously if no token is available or if user logs out
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    } catch (error) {
                        console.error("Authentication failed:", error);
                        // Fallback: Use a unique ID if auth completely fails
                        setUserId(crypto.randomUUID());
                    }
                }
            });

            return () => unsubscribe();

        } catch (error) {
            console.error("Firebase Initialization Error:", error);
        }
    }, []);


    // --- Firestore Cart Listener ---
    useEffect(() => {
        if (db && userId) {
            const cartDocRef = getPrivateDocRef(db, appId, userId, 'juisip_cart', 'current');

            const unsubscribe = onSnapshot(cartDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setCart(data.cart);
                    console.log("Cart updated from Firestore:", data.cart);
                } else {
                    // Initialize cart if document doesn't exist
                    console.log("Cart document does not exist, initializing...");
                    const initialCart = { ...initialCartState, lastUpdated: new Date() };
                    setCart(initialCart);
                    try {
                        // FIX: Use setDoc with the doc reference instead of docSnap.ref.set
                        setDoc(cartDocRef, { userId, cart: initialCart }, { merge: true });
                    } catch (e) {
                         console.error("Failed to initialize cart document:", e);
                    }
                }
            }, (error) => {
                console.error("Error listening to cart changes:", error);
            });

            return () => unsubscribe();
        }
    }, [db, userId]); // Re-run when db or userId changes


    // --- Cart Actions ---

    const updateFirestoreCart = useCallback(async (newCart) => {
        if (!db || !userId) return;

        try {
            const cartDocRef = getPrivateDocRef(db, appId, userId, 'juisip_cart', 'current');
            const batch = writeBatch(db);

            // Calculate new total
            const newTotal = newCart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

            const updatedCartState = {
                ...newCart,
                total: newTotal,
                lastUpdated: new Date().toISOString(),
            };

            batch.set(cartDocRef, { userId, cart: updatedCartState }, { merge: true });
            await batch.commit();

            // The onSnapshot listener will update the local 'cart' state
            setMessage("Cart updated successfully!");
        } catch (error) {
            console.error("Failed to update cart in Firestore:", error);
            setMessage("Error: Failed to update cart.");
        }
    }, [db, userId, appId]);


    const handleAddToCart = useCallback(async (item) => {
        const existingItemIndex = cart.items.findIndex(
            i => i.juiceId === item.juiceId &&
                 i.size === item.size &&
                 i.sweetness === item.sweetness &&
                 JSON.stringify(i.additions) === JSON.stringify(item.additions)
        );

        let newItems;
        if (existingItemIndex > -1) {
            // Item exists, update quantity
            newItems = cart.items.map((i, index) =>
                index === existingItemIndex ? { ...i, quantity: i.quantity + item.quantity } : i
            );
        } else {
            // New item
            newItems = [...cart.items, item];
        }

        const newCart = { ...cart, items: newItems };
        await updateFirestoreCart(newCart);
        setShowModal(false);
        setSelectedJuice(null);
    }, [cart, updateFirestoreCart]);


    const updateCartItemQuantity = useCallback(async (itemId, newQuantity) => {
        const newItems = cart.items.map(item =>
            item.id === itemId ? { ...item, quantity: newQuantity } : item
        ).filter(item => item.quantity > 0);

        const newCart = { ...cart, items: newItems };
        await updateFirestoreCart(newCart);
    }, [cart, updateFirestoreCart]);


    const removeItemFromCart = useCallback(async (itemId) => {
        const newItems = cart.items.filter(item => item.id !== itemId);
        const newCart = { ...cart, items: newItems };
        await updateFirestoreCart(newCart);
    }, [cart, updateFirestoreCart]);

    const setSelectedJuiceForModal = (juice) => {
        setSelectedJuice(juice);
        setShowModal(true);
    };

    // --- Render Logic ---
    return (
        <>
            <div className="min-h-screen bg-gray-50 font-sans antialiased flex flex-col items-center">
                {/* Header */}
                <Header setShowCart={setShowCart} cartItemCount={cart.items.length} />

                {/* Main Content */}
                <div className="container max-w-4xl p-4 sm:p-6 lg:p-8 flex-grow">
                    <div className="text-center mb-10">
                        <h2 className="text-4xl font-extrabold text-gray-900 mb-2">Build Your Perfect Sip</h2>
                        <p className="text-lg text-gray-600">Choose a base, then customize size, sweetness, and additions.</p>
                    </div>

                    {/* Juice Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {JUICES.map(juice => (
                            <JuiceCard key={juice.id} juice={juice} onCustomize={setSelectedJuiceForModal} />
                        ))}
                    </div>
                </div>

                {/* Modals */}
                {showModal && selectedJuice && (
                    <Modal title={`Customize ${selectedJuice.name}`} onClose={() => { setShowModal(false); setSelectedJuice(null); }}>
                        <CustomizationForm juice={selectedJuice} addToCart={handleAddToCart} />
                    </Modal>
                )}

                {showCart && (
                    <Modal title="Your Cart" onClose={() => setShowCart(false)}>
                        <CartView cart={cart} updateCartItemQuantity={updateCartItemQuantity} removeItemFromCart={removeItemFromCart} />
                    </Modal>
                )}

                {/* FIX: Use 'message' state variable for conditional rendering */}
                {message && (
                    <MessageToast message={message} setMessage={setMessage} />
                )}

                {/* Loading/User ID Display */}
                <div className="fixed bottom-0 right-0 p-2 text-xs text-gray-500 bg-white bg-opacity-80 rounded-tl-lg shadow-lg z-50">
                    {userId
                        ? <span className="flex items-center space-x-1">
                            <Info size={12} className="text-blue-500" />
                            <span>UserID: <span className="font-mono text-blue-600">{userId}</span></span>
                        </span>
                        : <span className="font-medium text-gray-500">Connecting...</span>
                    }
                </div>
            </div>
        </>
    );
};

export default App;

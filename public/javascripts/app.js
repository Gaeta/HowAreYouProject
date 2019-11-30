$( document ).ready(async function() {
    console.log('hi')
});


function switchTheme(){
    localStorage.setItem('mode', (localStorage.getItem('mode') || 'dark') === 'dark' ? 'light' : 'dark'); localStorage.getItem('mode') === 'dark' ? document.querySelector('body').classList.add('dark') : document.querySelector('body').classList.remove('dark')
}
//When page is loaded
document.addEventListener('DOMContentLoaded', (event) => {
  ((localStorage.getItem('mode') || 'dark') === 'dark') ? document.querySelector('body').classList.add('dark') : document.querySelector('body').classList.remove('dark')
})

//Get Cookies
function getCookie(cname) {
    var name = cname + "=";
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for(var i = 0; i <ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) == 0) {
        return c.substring(name.length, c.length);
      }
    }
    return "";
  }

//set a cookie to that sessiom
function setCookieSession(cname, cvalue) {
  var expires = "expires=Session";
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}  

//Hide Notification
function hideNotification(number){
    let Num = Number(number);
    let NotificationCookie = JSON.parse(getCookie('notifications'));
    NotificationCookie.push(Num);
    setCookieSession('notifications', JSON.stringify(NotificationCookie));
}


